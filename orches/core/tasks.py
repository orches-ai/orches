"""
Task registry — persistent storage in PostgreSQL via TaskModel.
"""
from __future__ import annotations
from datetime import datetime, timezone
from core.database import SessionLocal, TaskModel


def create(task_id: str, agent_id: str, user_input: str) -> TaskModel:
    with SessionLocal() as db:
        t = TaskModel(task_id=task_id, agent_id=agent_id, input=user_input, status="queued")
        db.add(t)
        db.commit()
        db.refresh(t)
        return t


def set_running(task_id: str) -> None:
    with SessionLocal() as db:
        t = db.get(TaskModel, task_id)
        if t:
            t.status = "running"
            db.commit()


def set_done(task_id: str, result: str) -> None:
    with SessionLocal() as db:
        t = db.get(TaskModel, task_id)
        if t:
            t.status = "done"
            t.result = result
            t.finished_at = datetime.now(timezone.utc)
            db.commit()


def set_error(task_id: str, error: str) -> None:
    with SessionLocal() as db:
        t = db.get(TaskModel, task_id)
        if t:
            t.status = "error"
            t.error = error
            t.finished_at = datetime.now(timezone.utc)
            db.commit()


def get(task_id: str) -> TaskModel | None:
    with SessionLocal() as db:
        return db.get(TaskModel, task_id)


def get_by_agent(agent_id: str) -> list[TaskModel]:
    with SessionLocal() as db:
        return db.query(TaskModel).filter(TaskModel.agent_id == agent_id).all()


def as_dict(t: TaskModel) -> dict:
    return {
        "task_id":    t.task_id,
        "agent_id":   t.agent_id,
        "input":      t.input,
        "status":     t.status,
        "result":     t.result,
        "error":      t.error,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "finished_at": t.finished_at.isoformat() if t.finished_at else None,
    }
