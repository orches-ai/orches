import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Awaitable


@dataclass
class AgentEvent:
    agent_id: str
    event_type: str  # started | thinking | tool_call | delegating | done | error
    payload: dict
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# Global event bus
_subscribers: list[Callable[[AgentEvent], Awaitable[None]]] = []


def subscribe(handler: Callable[[AgentEvent], Awaitable[None]]):
    _subscribers.append(handler)


def unsubscribe(handler: Callable[[AgentEvent], Awaitable[None]]):
    _subscribers.remove(handler)


async def emit(event: AgentEvent):
    for handler in list(_subscribers):
        try:
            await handler(event)
        except Exception:
            pass
