import asyncio
import os
from dataclasses import dataclass


@dataclass
class Task:
    run_id: str
    agent_id: str
    input: str
    depth: int = 0


class TaskQueue:
    def __init__(self):
        self.max_concurrent = int(os.getenv("MAX_CONCURRENT_AGENTS", 5))
        self._semaphore = asyncio.Semaphore(self.max_concurrent)
        self._queue: asyncio.Queue[Task] = asyncio.Queue()

    async def put(self, task: Task):
        await self._queue.put(task)

    async def get(self) -> Task:
        return await self._queue.get()

    def acquire(self):
        return self._semaphore

    @property
    def size(self) -> int:
        return self._queue.qsize()
