# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Run everything
```bash
./start.sh          # starts backend + frontend (opens browser)
./start.sh cli      # starts backend + opens CLI instead
```

### Backend only (from `orches/`)
```bash
source .venv/bin/activate
python3 main.py     # uvicorn on :8000 with reload
```

Logs when running via start.sh: `/tmp/orches.log`

### Frontend only (from `orches/frontend/`)
```bash
npm run dev         # Vite on :5173
npm run build
npx tsc --noEmit    # type check
```

### Setup from scratch
```bash
cd orches
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then edit .env
```

## Architecture

### Backend (`orches/`)

The system is a FastAPI app where agents are JSON configs (`.agent` files) run by a single engine.

**Data flow for a chat message:**
1. `POST /agents/{id}/run` → `core/engine.py:run_agent()`
2. Engine acquires a per-agent asyncio lock (serialises concurrent calls, tracks queue depth)
3. Engine builds the tool list from the agent's config, calls the LLM provider
4. If the LLM calls a tool → `_handle_tool_call()` → `tool_registry.call()` or recursive `run_agent()` for delegation
5. Every step emits an `AgentEvent` to `core/events.py` (in-process pub/sub)
6. WebSocket in `api/routes/ws.py` subscribes to the bus and forwards all events to the frontend

**Key files:**
- `core/engine.py` — all agent execution logic; two loops: `_run_anthropic_loop` and `_run_openai_loop` (Ollama uses the OpenAI-compatible loop)
- `core/events.py` — global in-process event bus (`subscribe` / `unsubscribe` / `emit`)
- `core/status.py` — per-agent asyncio locks and queue depth counters
- `providers/factory.py` — reads `PROVIDER` from env, returns the right provider; each agent can override via its config
- `registry/tool_registry.py` — auto-discovers builtin tools from `registry/tools/builtin/*.py` on startup
- `registry/agents/*.agent` — JSON configs persisted to disk; loaded on startup and mutated via REST API

**Agent config fields:** `id`, `name`, `system_prompt`, `tools` (list of tool names), `can_call` (agents this agent may delegate to), `provider`, `model`

**Adding a builtin tool:** create `registry/tools/builtin/yourname.py` with `TOOL_META` dict and `async execute(**kwargs) -> str`. It's auto-discovered on next startup. The `delegate` tool is special — its actual execution is intercepted by `_handle_tool_call()` in the engine, not by `execute()`.

**Provider selection:** `PROVIDER` env var sets the default. Per-agent override via `"provider"` field in `.agent` config. Anthropic uses the native SDK with its own tool format; OpenAI and Ollama share `_run_openai_loop` which uses the OpenAI-compatible format.

**Concurrency:** Each agent has one `asyncio.Lock` in `core/status.py`. Concurrent calls to the same agent queue up FIFO. Queue depth is tracked in `_waiters` and emitted as `queued`/`unqueued` events.

### Frontend (`orches/frontend/src/`)

FSD (Feature-Sliced Design) structure:
- `app/App.tsx` — root state: agents list, events, agentStatus, agentQueue, chatTabs, settingsStack
- `widgets/AgentGraph/` — SVG canvas with draggable nodes, zoom/pan, animated orchestrator card
- `widgets/Chat/` — multi-tab chat; one tab per agent, all state in App
- `widgets/EventLog/` — live stream of all WebSocket events
- `widgets/AgentSettings/` — modal stack for creating/editing agents
- `shared/config.ts` — API and WS URLs (`http://localhost:8000`, `ws://localhost:8000/ws/events`)
- `shared/types.ts` — `Agent`, `AgentEvent`, `Message` interfaces

**WebSocket:** `shared/hooks/useWebSocket.ts` connects on mount, calls `handleEvent` in App for every message. Events update `agentStatus` (drives node animation states) and `events` list (drives EventLog).

**Agent status animation:** The orchestrator card (`OrchGraph/index.tsx:OrchIcon`) maps status → SVG file: idle → `orches-character.svg`, any active state → `orches-character-animated-2.svg`, done/error → `orches-character-animated-3.svg`. Cache-busting via `?v={counter}` on each status change forces SVG re-animation.

**Settings modal stack:** Multiple `AgentSettings` modals can be open simultaneously (up to 5), stacked with depth offset. Managed via `settingsStack` array in App; `pushSettings(agent | null)` / `popSettings()`.

## Environment

`orches/.env` (copy from `.env.example`):
- `PROVIDER` — `anthropic` | `openai` | `ollama`
- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`
- `OPENAI_API_KEY` / `OPENAI_MODEL`
- `OLLAMA_URL`, `OLLAMA_NUM_CTX`, `LOCAL_MODEL`
- `WORKSPACE_DIR` — where file tools read/write (default `./workspace`)
- `MAX_DELEGATION_DEPTH` — max recursive delegation depth (default 3)
