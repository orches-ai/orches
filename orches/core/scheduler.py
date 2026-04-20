"""
Task Scheduler — runs scheduled agent tasks using APScheduler.
Checks the DB every minute for tasks where next_run_at <= now.
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from core.database import SessionLocal, TaskModel

logger = logging.getLogger(__name__)
_scheduler: AsyncIOScheduler | None = None


def compute_next_run(schedule: str) -> datetime | None:
    """Parse cron expression or ISO datetime → next run datetime (UTC)."""
    schedule = schedule.strip()
    # ISO datetime
    try:
        dt = datetime.fromisoformat(schedule)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        pass
    # Cron expression
    try:
        from croniter import croniter
        now = datetime.now(timezone.utc)
        it = croniter(schedule, now)
        return it.get_next(datetime).replace(tzinfo=timezone.utc)
    except Exception:
        pass
    return None


async def _tick():
    """Called every minute — fire any due scheduled tasks."""
    from core import engine
    now = datetime.now(timezone.utc)

    with SessionLocal() as db:
        due = (
            db.query(TaskModel)
            .filter(
                TaskModel.status == "scheduled",
                TaskModel.next_run_at <= now,
            )
            .all()
        )
        for task in due:
            task.status = "running"
            task.last_run_at = now
            db.commit()
            asyncio.create_task(_run_task(task.task_id, task.agent_id, task.input, task.schedule, task.repeat))


async def _run_task(task_id: str, agent_id: str, user_input: str, schedule: str | None, repeat: bool):
    from core import engine
    from core.database import SessionLocal, TaskModel
    try:
        result = await engine.run_agent(agent_id, user_input)
        with SessionLocal() as db:
            task = db.get(TaskModel, task_id)
            if task:
                task.result = result
                if repeat and schedule:
                    next_run = compute_next_run(schedule)
                    task.next_run_at = next_run
                    task.status = "scheduled"
                else:
                    task.status = "done"
                    task.finished_at = datetime.now(timezone.utc)
                db.commit()
    except Exception as exc:
        logger.error("Scheduled task %s failed: %s", task_id, exc)
        with SessionLocal() as db:
            task = db.get(TaskModel, task_id)
            if task:
                task.status = "error"
                task.error = str(exc)
                task.finished_at = datetime.now(timezone.utc)
                db.commit()


def start():
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(_tick, "interval", minutes=1, id="scheduler_tick")
    _scheduler.start()
    logger.info("Task scheduler started.")


def stop():
    if _scheduler:
        _scheduler.shutdown(wait=False)
