from fastapi import APIRouter, HTTPException
from core import tasks as task_registry

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("/{task_id}")
def get_task(task_id: str):
    t = task_registry.get(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return task_registry.as_dict(t)
