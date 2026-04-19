"""
AgentManager — loads agent configs, runs agents, handles delegation.
"""
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from core import events as bus
from core.events import AgentEvent
from core.router import can_delegate
from core import status as agent_status
from core import tasks as task_registry
from providers.factory import make_provider
import registry.tool_registry as tool_registry

_MAX_DEPTH      = int(os.getenv("MAX_DELEGATION_DEPTH", 3))
MAX_ITERATIONS  = int(os.getenv("MAX_ITERATIONS", 10))
MAX_TOOL_RETRIES = int(os.getenv("MAX_TOOL_RETRIES", 3))
TIMEOUT_SECONDS = int(os.getenv("TIMEOUT_SECONDS", 300))
_RETRY_DELAYS   = [300, 900, 2700]  # 5min → 15min → 45min

# Loaded agent configs: id → config dict
_agents: dict[str, dict] = {}


def load_agents_dir(path: str | Path = None):
    """Load all .agent files from registry/agents/."""
    if path is None:
        path = Path(__file__).parent.parent / "registry" / "agents"
    path = Path(path)
    for file in path.glob("*.agent"):
        with open(file) as f:
            config = json.load(f)
        _agents[config["id"]] = config


def register_agent(config: dict):
    _agents[config["id"]] = config


def remove_agent(agent_id: str):
    _agents.pop(agent_id, None)


def get_agent(agent_id: str) -> dict | None:
    return _agents.get(agent_id)


def list_agents() -> list[dict]:
    return list(_agents.values())


def _to_openai_tools(tool_defs: list[dict]) -> list[dict]:
    """Convert internal tool format to OpenAI/Ollama function-calling format."""
    result = []
    for t in tool_defs:
        result.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            }
        })
    return result


async def run_and_emit(task_id: str, agent_id: str, user_input: str) -> None:
    """Fire-and-forget wrapper: runs agent with retry, updates task registry, emits result."""
    await asyncio.sleep(0.2)
    task_registry.set_running(task_id)

    last_error = ""
    for attempt, delay in enumerate([0] + _RETRY_DELAYS):
        if delay:
            await bus.emit(AgentEvent(
                agent_id=agent_id,
                event_type="error",
                payload={"task_id": task_id, "error": last_error, "retry_in": delay, "attempt": attempt},
            ))
            await asyncio.sleep(delay)
            task_registry.set_running(task_id)

        try:
            result = await run_agent(agent_id, user_input)
            task_registry.set_done(task_id, result)
            await bus.emit(AgentEvent(
                agent_id=agent_id,
                event_type="result",
                payload={"task_id": task_id, "result": result},
            ))
            return
        except Exception as exc:
            last_error = str(exc)

    task_registry.set_error(task_id, last_error)
    await bus.emit(AgentEvent(
        agent_id=agent_id,
        event_type="result",
        payload={"task_id": task_id, "error": f"Failed after {len(_RETRY_DELAYS)+1} attempts: {last_error}"},
    ))


async def run_agent(agent_id: str, user_input: str, depth: int = 0) -> str:
    config = _agents.get(agent_id)
    if not config:
        return f"Error: agent '{agent_id}' not found"

    if depth > _MAX_DEPTH:
        return f"Error: max delegation depth ({_MAX_DEPTH}) reached"

    # ── Acquire per-agent lock (serialises concurrent calls to same agent) ──
    was_queued = await agent_status.acquire(agent_id, user_input)

    if was_queued:
        # We waited in queue — let subscribers know we're starting now
        await bus.emit(AgentEvent(
            agent_id=agent_id,
            event_type="unqueued",
            payload={"queue_depth": agent_status.queue_depth(agent_id)},
        ))

    try:
        return await asyncio.wait_for(
            _run_agent_inner(agent_id, config, user_input, depth),
            timeout=TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise RuntimeError(f"Agent '{agent_id}' timed out after {TIMEOUT_SECONDS}s")
    finally:
        agent_status.release(agent_id)
        await bus.emit(AgentEvent(
            agent_id=agent_id,
            event_type="status",
            payload=agent_status.get_one(agent_id),
        ))


async def _build_system_prompt(agent_id: str, config: dict, user_input: str = "") -> str:
    """Build system prompt: datetime + base prompt + tool hints + semantically relevant memory."""
    tool_names: list[str] = config.get("tools", [])
    now = datetime.now(timezone.utc).strftime("%A, %d %B %Y, %H:%M UTC")
    base_prompt: str = config.get("system_prompt", "You are a helpful assistant.")

    # Collect system_prompt_hint from each attached tool
    tool_hints = []
    for name in tool_names:
        tool = tool_registry.get(name)
        if tool:
            hint = tool["meta"].get("system_prompt_hint")
            if hint:
                tool_hints.append(hint)
    hints_block = ("\n\n" + "\n".join(tool_hints)) if tool_hints else ""

    # Auto-inject memories — semantic search when possible, else recency-based
    memory_context = ""
    if "memory" in tool_names:
        from core.database import SessionLocal, AgentMemoryModel
        from core.embeddings import get_embedding, cosine_similarity
        with SessionLocal() as _db:
            candidates = (
                _db.query(AgentMemoryModel)
                .filter(
                    (AgentMemoryModel.agent_id == agent_id) |
                    (AgentMemoryModel.scope == "global")
                )
                .all()
            )
        if candidates:
            if user_input:
                query_emb = await get_embedding(user_input)
                with_emb = [r for r in candidates if r.embedding is not None]
                if query_emb and with_emb:
                    rows = sorted(
                        with_emb,
                        key=lambda r: cosine_similarity(query_emb, list(r.embedding)),
                        reverse=True
                    )[:20]
                else:
                    rows = sorted(candidates, key=lambda r: r.updated_at, reverse=True)[:20]
            else:
                rows = sorted(candidates, key=lambda r: r.updated_at, reverse=True)[:20]

            lines = "\n".join(f"- [{r.scope}] {r.key}: {r.value}" for r in rows)
            memory_context = f"\n\nUser's stored data (from memory):\n{lines}"

    import core.app_settings as app_settings
    no_emoji_block = "\n\nDo not use emojis in your responses." if app_settings.get("no_emojis") else ""

    depth = app_settings.get("research_depth") or 2
    depth_labels = {1: "quick (2-3 sources max, be brief)", 2: "normal (5-7 sources)", 3: "deep (10+ sources, be thorough)"}
    depth_block = f"\n\nResearch depth: {depth}/3 — {depth_labels.get(depth, 'normal')}."

    return f"Current date and time: {now}\n\n{base_prompt}{hints_block}{memory_context}{no_emoji_block}{depth_block}"


async def _build_messages(agent_id: str, user_input: str, provider: str, model: str) -> list[dict]:
    """Load chat history and append the new user message.
    If auto_summarize is on and history is long, compress old turns first.
    """
    from core.database import SessionLocal, ChatMessageModel
    import core.app_settings as app_settings

    with SessionLocal() as db:
        rows = (
            db.query(ChatMessageModel)
            .filter(ChatMessageModel.agent_id == agent_id)
            .order_by(ChatMessageModel.created_at.asc())
            .all()
        )

    history: list[dict] = [{"role": r.role if r.role == "user" else "assistant", "content": r.text} for r in rows]

    threshold: int = app_settings.get("summarize_threshold") or 20
    if app_settings.get("auto_summarize") and len(history) > threshold:
        history = await _summarize_history(history, provider, model)

    return [*history, {"role": "user", "content": user_input}]


async def _summarize_history(history: list[dict], provider: str, model: str) -> list[dict]:
    """Compress all but the last 4 messages into a single summary assistant message."""
    keep_tail = 4
    to_summarize = history[:-keep_tail] if len(history) > keep_tail else history
    tail = history[-keep_tail:] if len(history) > keep_tail else []

    transcript = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in to_summarize
    )
    prompt = (
        "Summarize the following conversation concisely, preserving all key facts, "
        "decisions, and context that might be needed later:\n\n" + transcript
    )

    try:
        from providers.factory import default_provider, make_provider
        p = make_provider(provider, model)
        summary_text = await p.run([{"role": "user", "content": prompt}])
        summary_msg = {"role": "assistant", "content": f"[Conversation summary: {summary_text}]"}
        return [summary_msg, *tail]
    except Exception:
        # Fallback: just keep the tail if summarization fails
        return tail or history


async def _run_agent_inner(agent_id: str, config: dict, user_input: str, depth: int) -> str:
    """Core execution — called only when the agent lock is held."""
    import time
    from core.database import SessionLocal, AgentRunModel
    from core.costs import calculate_cost

    run_id = str(uuid.uuid4())
    started_ms = time.monotonic()

    from providers.factory import default_provider, make_provider_from_key
    from core.provider_keys import get_by_id as get_provider_key, get_by_provider as get_provider_key_fallback

    provider_key_id = config.get("provider_key_id")
    _key_entry = get_provider_key(provider_key_id) if provider_key_id else None

    if not _key_entry:
        env_provider, _ = default_provider()
        fallback_provider = config.get("provider") or env_provider
        _key_entry = get_provider_key_fallback(fallback_provider)

    if _key_entry:
        resolved_provider = _key_entry["provider"]
        resolved_model = config.get("model") or _key_entry.get("model") or ""
        if not resolved_model:
            from providers.factory import _DEFAULT_MODELS
            resolved_model = _DEFAULT_MODELS.get(resolved_provider, "llama3")
    else:
        env_provider, env_model = default_provider()
        resolved_provider = config.get("provider") or env_provider
        resolved_model = config.get("model") or env_model

    tool_names: list[str] = config.get("tools", [])
    system_prompt = await _build_system_prompt(agent_id, config, user_input)

    # Create run record
    run_ctx: dict = {"input_tokens": 0, "output_tokens": 0, "steps": []}
    with SessionLocal() as db:
        db_run = AgentRunModel(
            id=run_id, agent_id=agent_id, run_id=run_id,
            status="running", input=user_input,
        )
        db.add(db_run)
        db.commit()

    await bus.emit(AgentEvent(
        agent_id=agent_id,
        event_type="started",
        payload={"task": user_input, "run_id": run_id},
    ))

    tool_defs = []
    for name in tool_names:
        tool = tool_registry.get(name)
        if tool:
            tool_defs.append({
                "name": tool["meta"]["name"],
                "description": tool["meta"]["description"],
                "input_schema": tool["meta"]["input_schema"],
            })

    messages = await _build_messages(agent_id, user_input, resolved_provider, resolved_model)

    await bus.emit(AgentEvent(
        agent_id=agent_id,
        event_type="thinking",
        payload={"messages_len": len(messages)},
    ))

    status = "success"
    error = None
    result_text = ""
    # Guard: no key configured at all
    _has_key = bool(
        _key_entry or
        os.getenv("ANTHROPIC_API_KEY") or
        os.getenv("OPENAI_API_KEY") or
        (resolved_provider == "ollama")
    )
    if not _has_key:
        raise RuntimeError(
            "No API key configured. Open Settings → API Keys and add a key for your provider."
        )

    _is_openai_compat = resolved_provider != "anthropic" and (
        resolved_provider in ("ollama", "openai") or
        (_key_entry and (_key_entry.get("base_url") or resolved_provider not in ("anthropic",)))
    )
    try:
        if resolved_provider == "anthropic":
            result_text = await _run_anthropic_loop(agent_id, config, messages, tool_defs, system_prompt, depth, run_ctx, resolved_model=resolved_model, key_entry=_key_entry)
        elif _is_openai_compat:
            result_text = await _run_openai_loop(agent_id, config, messages, tool_defs, system_prompt, depth, resolved_provider, run_ctx, resolved_model=resolved_model, key_entry=_key_entry)
        else:
            provider = make_provider(config.get("provider"), config.get("model"))
            result_text = await provider.run(messages)
    except Exception as exc:
        status = "failed"
        error = str(exc)
        raise
    finally:
        duration_ms = int((time.monotonic() - started_ms) * 1000)
        inp, out = run_ctx["input_tokens"], run_ctx["output_tokens"]
        cost = calculate_cost(resolved_model, inp, out)
        with SessionLocal() as db:
            row = db.query(AgentRunModel).filter_by(id=run_id).first()
            if row:
                row.status = status
                row.output = result_text
                row.steps = run_ctx["steps"]
                row.input_tokens = inp
                row.output_tokens = out
                row.duration_ms = duration_ms
                row.error = error
                row.finished_at = datetime.now(timezone.utc)
                db.commit()
        await bus.emit(AgentEvent(
            agent_id=agent_id,
            event_type="done",
            payload={"result": result_text[:200], "tokens": inp + out, "cost": cost},
        ))

    return result_text


async def _handle_tool_call(agent_id: str, config: dict, tool_name: str, tool_input: dict, depth: int, run_ctx: dict | None = None) -> str:
    """Execute a tool call or delegation, emit events."""
    await bus.emit(AgentEvent(
        agent_id=agent_id,
        event_type="tool_call",
        payload={"tool": tool_name, "input": tool_input},
    ))

    if tool_name == "delegate" and can_delegate(config, tool_input.get("agent_id", "")):
        target_id = tool_input["agent_id"]
        task = tool_input.get("task", "")
        is_target_busy = agent_status.is_busy(target_id)
        await bus.emit(AgentEvent(
            agent_id=agent_id,
            event_type="delegating",
            payload={"to": target_id, "task": task, "queued": is_target_busy},
        ))
        if is_target_busy:
            await bus.emit(AgentEvent(
                agent_id=target_id,
                event_type="queued",
                payload={
                    "task": task[:80],
                    "from": agent_id,
                    "queue_depth": agent_status.queue_depth(target_id) + 1,
                },
            ))
        agent_status.register_delegate(agent_id, target_id)
        try:
            result = await run_agent(target_id, task, depth=depth + 1)
        finally:
            agent_status.unregister_delegate(agent_id, target_id)
        if agent_status.is_cancelled(agent_id):
            raise asyncio.CancelledError(f"Agent '{agent_id}' stopped by user")
        return result

    # Inject agent_id into tools that need it for context
    if tool_name == "memory":
        try:
            from registry.tools.builtin.memory import set_agent_id
            set_agent_id(agent_id)
        except ImportError:
            pass
    if tool_name == "canvas_open":
        try:
            from registry.tools.builtin.canvas_open import set_agent_id as _set_canvas_agent
            _set_canvas_agent(agent_id)
        except ImportError:
            pass

    import time as _time
    t0 = _time.monotonic()
    last_err: Exception | None = None
    for attempt in range(MAX_TOOL_RETRIES):
        try:
            output = await tool_registry.call(tool_name, **tool_input)
            if run_ctx is not None:
                run_ctx["steps"].append({
                    "tool": tool_name, "input": tool_input,
                    "output": str(output)[:500],
                    "time_ms": int((_time.monotonic() - t0) * 1000),
                })
            return output
        except Exception as exc:
            last_err = exc
            if attempt < MAX_TOOL_RETRIES - 1:
                await asyncio.sleep(2 ** attempt)
    raise RuntimeError(f"Tool '{tool_name}' failed after {MAX_TOOL_RETRIES} attempts: {last_err}")


async def _run_anthropic_loop(
    agent_id: str,
    config: dict,
    messages: list[dict],
    tool_defs: list[dict],
    system_prompt: str,
    depth: int,
    run_ctx: dict | None = None,
    resolved_model: str | None = None,
    key_entry: dict | None = None,
) -> str:
    import anthropic as sdk

    from providers.factory import default_provider
    _, env_model = default_provider()
    model = resolved_model or config.get("model") or env_model

    api_key = key_entry["key"] if key_entry and key_entry.get("key") else os.getenv("ANTHROPIC_API_KEY")
    client = sdk.AsyncAnthropic(api_key=api_key)

    for iteration in range(MAX_ITERATIONS):
        if agent_status.is_cancelled(agent_id):
            raise asyncio.CancelledError(f"Agent '{agent_id}' stopped by user")

        kwargs = {
            "model": model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": messages,
        }
        if tool_defs:
            kwargs["tools"] = tool_defs

        response = await client.messages.create(**kwargs)

        if run_ctx is not None:
            run_ctx["input_tokens"]  += getattr(response.usage, "input_tokens",  0)
            run_ctx["output_tokens"] += getattr(response.usage, "output_tokens", 0)

        text_parts = [b.text for b in response.content if b.type == "text"]
        result_text = "\n".join(text_parts)

        if response.stop_reason != "tool_use":
            return result_text

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            output = await _handle_tool_call(agent_id, config, block.name, block.input, depth, run_ctx)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": str(output),
            })

        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

    raise RuntimeError(f"Agent '{agent_id}' exceeded MAX_ITERATIONS ({MAX_ITERATIONS})")


async def _run_openai_loop(
    agent_id: str,
    config: dict,
    messages: list[dict],
    tool_defs: list[dict],
    system_prompt: str,
    depth: int,
    provider_name: str,
    run_ctx: dict | None = None,
    resolved_model: str | None = None,
    key_entry: dict | None = None,
) -> str:
    """Tool-use loop for Ollama and OpenAI (both use OpenAI-compatible format)."""
    import httpx

    from providers.factory import default_provider
    _, env_model = default_provider()
    model = resolved_model or config.get("model") or env_model

    if provider_name == "ollama":
        base_url = (key_entry.get("url") if key_entry else None) or os.getenv("OLLAMA_URL", "http://localhost:11434")
        url = f"{base_url}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
    else:
        custom_base = key_entry.get("base_url") if key_entry else None
        base_url = custom_base or "https://api.openai.com"
        url = f"{base_url.rstrip('/')}/v1/chat/completions"
        api_key = (key_entry.get("key") if key_entry else None) or os.getenv("OPENAI_API_KEY")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

    full_messages = [{"role": "system", "content": system_prompt}] + messages
    openai_tools = _to_openai_tools(tool_defs) if tool_defs else None

    async with httpx.AsyncClient(timeout=120) as client:
        for iteration in range(MAX_ITERATIONS):
            body: dict = {"model": model, "messages": full_messages}
            if openai_tools:
                body["tools"] = openai_tools
            if provider_name == "ollama":
                body["options"] = {"num_ctx": int(os.getenv("OLLAMA_NUM_CTX", 4096))}

            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()

            if run_ctx is not None and "usage" in data:
                run_ctx["input_tokens"]  += data["usage"].get("prompt_tokens", 0)
                run_ctx["output_tokens"] += data["usage"].get("completion_tokens", 0)

            message = data["choices"][0]["message"]
            tool_calls = message.get("tool_calls") or []

            if not tool_calls:
                content = message.get("content") or ""
                # Fallback: some models output tool calls as JSON text instead
                # of using the tool_calls field. Detect and execute them.
                if content.strip().startswith("{") and '"name"' in content:
                    try:
                        parsed = json.loads(content.strip())
                        tool_name = parsed.get("name") or parsed.get("tool")
                        tool_input = parsed.get("parameters") or parsed.get("arguments") or parsed.get("input") or {}
                        if tool_name:
                            fake_id = "fallback-0"
                            full_messages.append({
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [{"id": fake_id, "type": "function", "function": {"name": tool_name, "arguments": json.dumps(tool_input)}}],
                            })
                            output = await _handle_tool_call(agent_id, config, tool_name, tool_input, depth, run_ctx)
                            full_messages.append({"role": "tool", "tool_call_id": fake_id, "content": str(output)})
                            continue
                    except Exception:
                        pass
                return content

            # Strip content from assistant message when tool_calls are present
            msg_for_history = {k: v for k, v in message.items() if k != "content"}
            msg_for_history["content"] = None
            full_messages.append(msg_for_history)

            # Execute each tool call and collect results
            tool_results_summary: list[str] = []
            for tc in tool_calls:
                fn = tc["function"]
                tool_name = fn["name"]
                try:
                    tool_input = json.loads(fn["arguments"])
                except Exception:
                    tool_input = {}

                await bus.emit(AgentEvent(
                    agent_id=agent_id,
                    event_type="thinking",
                    payload={"messages_len": len(full_messages)},
                ))

                output = await _handle_tool_call(agent_id, config, tool_name, tool_input, depth, run_ctx)
                output_str = str(output)

                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": output_str,
                })
                tool_results_summary.append(f"[{tool_name}] result:\n{output_str}")

            # Inject an explicit reminder so small models don't ignore tool results
            if tool_results_summary:
                reminder = (
                    "Tool results received:\n\n"
                    + "\n\n".join(tool_results_summary)
                    + "\n\nUsing ONLY the above results, answer the user's original question. "
                    "Do not use your training knowledge. Do not call any more tools."
                )
                full_messages.append({"role": "user", "content": reminder})

    raise RuntimeError(f"Agent '{agent_id}' exceeded MAX_ITERATIONS ({MAX_ITERATIONS})")


# ── Streaming versions ────────────────────────────────────────────────────────

async def _heartbeat(agent_id: str, stop: asyncio.Event, interval: int = 15) -> None:
    elapsed = 0
    while not stop.is_set():
        try:
            await asyncio.wait_for(asyncio.shield(stop.wait()), timeout=interval)
        except asyncio.TimeoutError:
            pass
        if stop.is_set():
            break
        elapsed += interval
        await bus.emit(AgentEvent(
            agent_id=agent_id,
            event_type="heartbeat",
            payload={"elapsed": elapsed},
        ))


async def run_agent_stream(agent_id: str, user_input: str, depth: int = 0) -> AsyncIterator[str]:
    config = _agents.get(agent_id)
    if not config:
        yield f"Error: agent '{agent_id}' not found"
        return

    if depth > _MAX_DEPTH:
        yield f"Error: max delegation depth ({_MAX_DEPTH}) reached"
        return

    was_queued = await agent_status.acquire(agent_id, user_input)
    if was_queued:
        await bus.emit(AgentEvent(
            agent_id=agent_id,
            event_type="unqueued",
            payload={"queue_depth": agent_status.queue_depth(agent_id)},
        ))

    stop = asyncio.Event()
    hb_task = asyncio.create_task(_heartbeat(agent_id, stop))
    try:
        async for chunk in _run_agent_inner_stream(agent_id, config, user_input, depth):
            yield chunk
    finally:
        stop.set()
        hb_task.cancel()
        agent_status.release(agent_id)
        await bus.emit(AgentEvent(
            agent_id=agent_id,
            event_type="status",
            payload=agent_status.get_one(agent_id),
        ))


async def _run_agent_inner_stream(
    agent_id: str, config: dict, user_input: str, depth: int
) -> AsyncIterator[str]:
    run_id = str(uuid.uuid4())
    from providers.factory import default_provider
    from core.provider_keys import get_by_id as get_provider_key, get_by_provider as get_provider_key_fallback

    provider_key_id = config.get("provider_key_id")
    _key_entry = get_provider_key(provider_key_id) if provider_key_id else None

    if not _key_entry:
        env_provider, _ = default_provider()
        fallback_provider = config.get("provider") or env_provider
        _key_entry = get_provider_key_fallback(fallback_provider)

    if _key_entry:
        resolved_provider = _key_entry["provider"]
        resolved_model_stream = config.get("model") or _key_entry.get("model") or ""
        if not resolved_model_stream:
            from providers.factory import _DEFAULT_MODELS
            resolved_model_stream = _DEFAULT_MODELS.get(resolved_provider, "llama3")
    else:
        env_provider, env_model = default_provider()
        resolved_provider = config.get("provider") or env_provider
        resolved_model_stream = config.get("model") or env_model

    _has_key_stream = bool(
        _key_entry or
        os.getenv("ANTHROPIC_API_KEY") or
        os.getenv("OPENAI_API_KEY") or
        (resolved_provider == "ollama")
    )
    if not _has_key_stream:
        yield "⚠️ No API key configured. Open **Settings → API Keys** and add a key for your provider."
        return

    tool_names: list[str] = config.get("tools", [])
    system_prompt = await _build_system_prompt(agent_id, config, user_input)

    await bus.emit(AgentEvent(
        agent_id=agent_id,
        event_type="started",
        payload={"task": user_input, "run_id": run_id},
    ))

    tool_defs = []
    for name in tool_names:
        tool = tool_registry.get(name)
        if tool:
            tool_defs.append({
                "name": tool["meta"]["name"],
                "description": tool["meta"]["description"],
                "input_schema": tool["meta"]["input_schema"],
            })

    messages = await _build_messages(agent_id, user_input, resolved_provider, resolved_model_stream)

    await bus.emit(AgentEvent(
        agent_id=agent_id,
        event_type="thinking",
        payload={"messages_len": len(messages)},
    ))

    result_parts: list[str] = []

    _is_openai_compat_stream = resolved_provider != "anthropic" and (
        resolved_provider in ("ollama", "openai") or
        (_key_entry and (_key_entry.get("base_url") or resolved_provider not in ("anthropic",)))
    )
    if resolved_provider == "anthropic":
        async for chunk in _run_anthropic_loop_stream(agent_id, config, messages, tool_defs, system_prompt, depth, resolved_model=resolved_model_stream, key_entry=_key_entry):
            result_parts.append(chunk)
            yield chunk
    elif _is_openai_compat_stream:
        async for chunk in _run_openai_loop_stream(agent_id, config, messages, tool_defs, system_prompt, depth, resolved_provider, resolved_model=resolved_model_stream, key_entry=_key_entry):
            result_parts.append(chunk)
            yield chunk
    else:
        provider = make_provider(config.get("provider"), config.get("model"))
        result_text = await provider.run(messages)
        result_parts.append(result_text)
        yield result_text

    result_text = "".join(result_parts)
    await bus.emit(AgentEvent(
        agent_id=agent_id,
        event_type="done",
        payload={"result": result_text[:200]},
    ))


async def _run_anthropic_loop_stream(
    agent_id: str,
    config: dict,
    messages: list[dict],
    tool_defs: list[dict],
    system_prompt: str,
    depth: int,
    resolved_model: str | None = None,
    key_entry: dict | None = None,
) -> AsyncIterator[str]:
    import anthropic as sdk

    from providers.factory import default_provider
    _, env_model = default_provider()
    model = resolved_model or config.get("model") or env_model
    api_key = key_entry["key"] if key_entry and key_entry.get("key") else os.getenv("ANTHROPIC_API_KEY")
    client = sdk.AsyncAnthropic(api_key=api_key)

    for iteration in range(MAX_ITERATIONS):
        kwargs: dict = {
            "model": model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": messages,
        }
        if tool_defs:
            kwargs["tools"] = tool_defs

        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
            response = await stream.get_final_message()

        if response.stop_reason != "tool_use":
            return

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            output = await _handle_tool_call(agent_id, config, block.name, block.input, depth)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": str(output),
            })

        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

    raise RuntimeError(f"Agent '{agent_id}' exceeded MAX_ITERATIONS ({MAX_ITERATIONS})")


async def _run_openai_loop_stream(
    agent_id: str,
    config: dict,
    messages: list[dict],
    tool_defs: list[dict],
    system_prompt: str,
    depth: int,
    provider_name: str,
    resolved_model: str | None = None,
    key_entry: dict | None = None,
) -> AsyncIterator[str]:
    import httpx

    from providers.factory import default_provider
    _, env_model = default_provider()
    model = resolved_model or config.get("model") or env_model

    if provider_name == "ollama":
        base_url = (key_entry.get("url") if key_entry else None) or os.getenv("OLLAMA_URL", "http://localhost:11434")
        url = f"{base_url}/v1/chat/completions"
        headers: dict = {"Content-Type": "application/json"}
    else:
        custom_base = key_entry.get("base_url") if key_entry else None
        base_url = custom_base or "https://api.openai.com"
        url = f"{base_url.rstrip('/')}/v1/chat/completions"
        api_key = (key_entry.get("key") if key_entry else None) or os.getenv("OPENAI_API_KEY")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

    full_messages = [{"role": "system", "content": system_prompt}] + messages
    openai_tools = _to_openai_tools(tool_defs) if tool_defs else None

    async with httpx.AsyncClient(timeout=120) as client:
        for iteration in range(MAX_ITERATIONS):
            body: dict = {"model": model, "messages": full_messages, "stream": True}
            if openai_tools:
                body["tools"] = openai_tools
            if provider_name == "ollama":
                body["options"] = {"num_ctx": int(os.getenv("OLLAMA_NUM_CTX", 4096))}

            tool_calls_acc: dict[int, dict] = {}

            async with client.stream("POST", url, headers=headers, json=body) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                    except Exception:
                        continue

                    choice = chunk.get("choices", [{}])[0]
                    delta = choice.get("delta", {})

                    content = delta.get("content")
                    if content:
                        yield content

                    for tc_delta in delta.get("tool_calls", []):
                        idx = tc_delta["index"]
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {"id": "", "function": {"name": "", "arguments": ""}}
                        if tc_delta.get("id"):
                            tool_calls_acc[idx]["id"] = tc_delta["id"]
                        fn = tc_delta.get("function", {})
                        if fn.get("name"):
                            tool_calls_acc[idx]["function"]["name"] += fn["name"]
                        if fn.get("arguments"):
                            tool_calls_acc[idx]["function"]["arguments"] += fn["arguments"]

            if not tool_calls_acc:
                return

            tool_calls_list = [tool_calls_acc[i] for i in sorted(tool_calls_acc.keys())]
            full_messages.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [{"id": tc["id"], "type": "function", "function": tc["function"]} for tc in tool_calls_list],
            })

            tool_results_summary: list[str] = []
            for tc in tool_calls_list:
                fn = tc["function"]
                tool_name = fn["name"]
                try:
                    tool_input = json.loads(fn["arguments"])
                except Exception:
                    tool_input = {}

                await bus.emit(AgentEvent(
                    agent_id=agent_id,
                    event_type="thinking",
                    payload={"messages_len": len(full_messages)},
                ))

                output = await _handle_tool_call(agent_id, config, tool_name, tool_input, depth)
                output_str = str(output)
                full_messages.append({"role": "tool", "tool_call_id": tc["id"], "content": output_str})
                tool_results_summary.append(f"[{tool_name}] result:\n{output_str}")

            if tool_results_summary:
                reminder = (
                    "Tool results received:\n\n"
                    + "\n\n".join(tool_results_summary)
                    + "\n\nUsing ONLY the above results, answer the user's original question. "
                    "Do not use your training knowledge. Do not call any more tools."
                )
                full_messages.append({"role": "user", "content": reminder})

    raise RuntimeError(f"Agent '{agent_id}' exceeded MAX_ITERATIONS ({MAX_ITERATIONS})")
