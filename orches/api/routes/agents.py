import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import engine
from core import status as agent_status
from core.database import SessionLocal, ChatMessageModel, AgentRunModel, TaskModel
from core.costs import calculate_cost
from core.scheduler import compute_next_run

router = APIRouter(prefix="/agents", tags=["agents"])

AGENTS_DIR = Path(__file__).parent.parent.parent / "registry" / "agents"


class AgentCreate(BaseModel):
    config: dict


class RunRequest(BaseModel):
    input: str


@router.get("/")
def list_agents():
    return engine.list_agents()


@router.get("/status")
def get_status():
    """Runtime status for all agents: idle/busy + queue depth."""
    return agent_status.get_all()


@router.get("/{agent_id}")
def get_agent(agent_id: str):
    agent = engine.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.get("/{agent_id}/status")
def get_agent_status(agent_id: str):
    return agent_status.get_one(agent_id)


@router.post("/")
def create_agent(body: AgentCreate):
    config = body.config
    if "id" not in config:
        raise HTTPException(status_code=400, detail="Config must have 'id'")
    _save_agent_file(config)
    engine.register_agent(config)
    return {"status": "created", "id": config["id"]}


@router.put("/{agent_id}")
def update_agent(agent_id: str, body: AgentCreate):
    config = body.config
    if config.get("id") != agent_id:
        raise HTTPException(status_code=400, detail="ID mismatch")
    _save_agent_file(config)
    engine.register_agent(config)
    return {"status": "updated", "id": agent_id}


class AgentModelPatch(BaseModel):
    provider_key_id: str | None = None
    model: str | None = None


@router.patch("/{agent_id}/model")
def patch_agent_model(agent_id: str, body: AgentModelPatch):
    """Update only provider_key_id and/or model for an agent."""
    agent = engine.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    config = dict(agent)
    if body.provider_key_id is not None:
        config["provider_key_id"] = body.provider_key_id or None
    if body.model is not None:
        config["model"] = body.model or None
    _save_agent_file(config)
    engine.register_agent(config)
    return {"status": "updated", "id": agent_id}


@router.delete("/{agent_id}")
def delete_agent(agent_id: str):
    agent = engine.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent_file = AGENTS_DIR / f"{agent_id}.agent"
    if agent_file.exists():
        agent_file.unlink()

    engine.remove_agent(agent_id)
    return {"status": "deleted", "id": agent_id}


@router.post("/{agent_id}/run")
async def run_agent(agent_id: str, body: RunRequest):
    agent = engine.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    result = await engine.run_agent(agent_id, body.input)
    return {"status": "done", "result": result}


@router.post("/{agent_id}/stop")
async def stop_agent(agent_id: str):
    from core import status as agent_status
    agent_status.cancel(agent_id)
    return {"status": "stop_requested", "agent_id": agent_id}


@router.post("/{agent_id}/run/stream")
async def run_agent_stream(agent_id: str, body: RunRequest):
    import asyncio as _asyncio
    agent = engine.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    queue: _asyncio.Queue = _asyncio.Queue()

    async def _run():
        _save_message(agent_id, "user", body.input)
        full_text = ""
        try:
            async for chunk in engine.run_agent_stream(agent_id, body.input):
                full_text += chunk
                await queue.put(("chunk", chunk))
        finally:
            if full_text:
                _save_message(agent_id, "agent", full_text)
            await queue.put(("done", full_text))

    _asyncio.create_task(_run())

    async def generate():
        while True:
            kind, data = await queue.get()
            if kind == "chunk":
                yield f"data: {json.dumps({'type': 'chunk', 'text': data})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'done', 'result': data})}\n\n"
                break

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{agent_id}/stats")
def get_stats(agent_id: str):
    """Total runs, tokens, estimated cost for an agent."""
    import os
    from providers.factory import default_provider
    _, env_model = default_provider()
    agent = engine.get_agent(agent_id)
    model = (agent or {}).get("model") or env_model

    with SessionLocal() as db:
        runs = (
            db.query(AgentRunModel)
            .filter(AgentRunModel.agent_id == agent_id)
            .all()
        )
    total_runs    = len(runs)
    input_tokens  = sum(r.input_tokens  or 0 for r in runs)
    output_tokens = sum(r.output_tokens or 0 for r in runs)
    cost          = calculate_cost(model, input_tokens, output_tokens)
    avg_duration  = (
        int(sum(r.duration_ms for r in runs if r.duration_ms) / max(1, sum(1 for r in runs if r.duration_ms)))
        if runs else 0
    )
    return {
        "total_runs":    total_runs,
        "input_tokens":  input_tokens,
        "output_tokens": output_tokens,
        "tokens_used":   input_tokens + output_tokens,
        "cost_usd":      round(cost, 6),
        "avg_duration_ms": avg_duration,
    }


class ScheduledTaskCreate(BaseModel):
    input: str
    schedule: str        # ISO datetime or cron expression
    repeat: bool = False


def _task_dict(t: TaskModel) -> dict:
    return {
        "task_id":    t.task_id,
        "agent_id":   t.agent_id,
        "input":      t.input,
        "status":     t.status,
        "schedule":   t.schedule,
        "repeat":     t.repeat,
        "next_run_at": t.next_run_at.isoformat() if t.next_run_at else None,
        "last_run_at": t.last_run_at.isoformat() if t.last_run_at else None,
        "result":     t.result,
        "error":      t.error,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@router.get("/{agent_id}/tasks")
def list_tasks(agent_id: str):
    with SessionLocal() as db:
        rows = (
            db.query(TaskModel)
            .filter(TaskModel.agent_id == agent_id)
            .order_by(TaskModel.created_at.desc())
            .all()
        )
        return [_task_dict(r) for r in rows]


@router.post("/{agent_id}/tasks")
def create_task(agent_id: str, body: ScheduledTaskCreate):
    next_run = compute_next_run(body.schedule)
    if not next_run:
        raise HTTPException(status_code=400, detail="Invalid schedule — use ISO datetime or cron expression")
    task_id = str(uuid.uuid4())
    with SessionLocal() as db:
        t = TaskModel(
            task_id=task_id, agent_id=agent_id,
            input=body.input, status="scheduled",
            schedule=body.schedule, repeat=body.repeat,
            next_run_at=next_run,
        )
        db.add(t)
        db.commit()
    return {"task_id": task_id, "next_run_at": next_run.isoformat()}


@router.post("/{agent_id}/tasks/{task_id}/run")
async def run_task_now(agent_id: str, task_id: str):
    """Trigger a scheduled task immediately."""
    import asyncio as _asyncio
    with SessionLocal() as db:
        t = db.get(TaskModel, task_id)
        if not t or t.agent_id != agent_id:
            raise HTTPException(status_code=404, detail="Task not found")
        t.status = "running"
        t.last_run_at = datetime.now(timezone.utc)
        db.commit()
        user_input = t.input
        schedule = t.schedule
        repeat = t.repeat

    async def _run():
        from core.database import SessionLocal, TaskModel
        try:
            result = await engine.run_agent(agent_id, user_input)
            with SessionLocal() as db:
                task = db.get(TaskModel, task_id)
                if task:
                    task.result = result
                    if repeat and schedule:
                        task.next_run_at = compute_next_run(schedule)
                        task.status = "scheduled"
                    else:
                        task.status = "done"
                        task.finished_at = datetime.now(timezone.utc)
                    db.commit()
        except Exception as exc:
            with SessionLocal() as db:
                task = db.get(TaskModel, task_id)
                if task:
                    task.status = "error"
                    task.error = str(exc)
                    task.finished_at = datetime.now(timezone.utc)
                    db.commit()

    _asyncio.create_task(_run())
    return {"status": "started", "task_id": task_id}


@router.post("/{agent_id}/tasks/{task_id}/cancel")
def cancel_task(agent_id: str, task_id: str):
    with SessionLocal() as db:
        t = db.get(TaskModel, task_id)
        if not t or t.agent_id != agent_id:
            raise HTTPException(status_code=404, detail="Task not found")
        t.status = "cancelled"
        db.commit()
    return {"status": "cancelled"}


@router.delete("/{agent_id}/tasks/{task_id}")
def delete_task(agent_id: str, task_id: str):
    with SessionLocal() as db:
        t = db.get(TaskModel, task_id)
        if not t or t.agent_id != agent_id:
            raise HTTPException(status_code=404, detail="Task not found")
        db.delete(t)
        db.commit()
    return {"status": "deleted"}


@router.get("/{agent_id}/history")
def get_history(agent_id: str, limit: int = 100):
    with SessionLocal() as db:
        rows = (
            db.query(ChatMessageModel)
            .filter(ChatMessageModel.agent_id == agent_id)
            .order_by(ChatMessageModel.created_at.asc())
            .limit(limit)
            .all()
        )
        return [{"role": r.role, "text": r.text} for r in rows]


@router.delete("/{agent_id}/history")
def clear_history(agent_id: str):
    with SessionLocal() as db:
        db.query(ChatMessageModel).filter(ChatMessageModel.agent_id == agent_id).delete()
        db.commit()
    return {"status": "cleared"}


def _save_message(agent_id: str, role: str, text: str):
    with SessionLocal() as db:
        db.add(ChatMessageModel(id=str(uuid.uuid4()), agent_id=agent_id, role=role, text=text))
        db.commit()


def _save_agent_file(config: dict):
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    path = AGENTS_DIR / f"{config['id']}.agent"
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
