"""
AgentRuntimeStatus — per-agent lock and queue depth tracking.

Each agent has exactly one asyncio.Lock. Concurrent calls to the same agent
wait on the lock (FIFO). _waiters tracks how many are waiting so the frontend
can show a queue depth badge.
"""
import asyncio
from dataclasses import dataclass, field
from typing import Literal

# ── Data ─────────────────────────────────────────────────────────────────────

@dataclass
class AgentRuntimeStatus:
    agent_id: str
    state: Literal["idle", "busy"] = "idle"
    queue_depth: int = 0          # tasks waiting (not including the running one)
    current_task: str | None = None


# ── Internal state ────────────────────────────────────────────────────────────

_status:    dict[str, AgentRuntimeStatus] = {}
_locks:     dict[str, asyncio.Lock]       = {}
_waiters:   dict[str, int]                = {}   # separate from Lock internals
_cancel:    dict[str, asyncio.Event]      = {}   # cancel signals per agent
_delegates: dict[str, set[str]]           = {}   # parent_id → set of active child agent_ids


def _ensure(agent_id: str) -> AgentRuntimeStatus:
    if agent_id not in _status:
        _status[agent_id]    = AgentRuntimeStatus(agent_id=agent_id)
        _locks[agent_id]     = asyncio.Lock()
        _waiters[agent_id]   = 0
        _cancel[agent_id]    = asyncio.Event()
        _delegates[agent_id] = set()
    return _status[agent_id]


# ── Public API ────────────────────────────────────────────────────────────────

def is_busy(agent_id: str) -> bool:
    _ensure(agent_id)
    return _locks[agent_id].locked()


def queue_depth(agent_id: str) -> int:
    _ensure(agent_id)
    return _waiters[agent_id]


async def acquire(agent_id: str, task: str) -> bool:
    """
    Acquire the agent lock. Returns True if the agent was busy (task was queued),
    False if it was idle (ran immediately).
    Increments waiter counter while waiting so the frontend can show queue depth.
    """
    st = _ensure(agent_id)
    was_busy = _locks[agent_id].locked()

    if was_busy:
        _waiters[agent_id] += 1
        st.queue_depth = _waiters[agent_id]

    await _locks[agent_id].acquire()

    # Now holding the lock — we are no longer waiting
    if was_busy:
        _waiters[agent_id] = max(0, _waiters[agent_id] - 1)

    st.state        = "busy"
    st.current_task = task[:120]
    st.queue_depth  = _waiters[agent_id]
    return was_busy


def release(agent_id: str) -> None:
    """Release the agent lock and update status to idle."""
    st = _ensure(agent_id)
    st.state        = "idle"
    st.current_task = None
    st.queue_depth  = _waiters.get(agent_id, 0)
    _cancel[agent_id].clear()
    _locks[agent_id].release()


def register_delegate(parent_id: str, child_id: str) -> None:
    _ensure(parent_id)
    _delegates[parent_id].add(child_id)


def unregister_delegate(parent_id: str, child_id: str) -> None:
    _ensure(parent_id)
    _delegates[parent_id].discard(child_id)


def cancel(agent_id: str) -> None:
    """Signal the running agent and its entire delegation chain to stop."""
    _ensure(agent_id)
    _cancel[agent_id].set()
    for child_id in list(_delegates.get(agent_id, set())):
        cancel(child_id)


def is_cancelled(agent_id: str) -> bool:
    _ensure(agent_id)
    return _cancel[agent_id].is_set()


def get_all() -> list[dict]:
    return [
        {
            "agent_id":    s.agent_id,
            "state":       s.state,
            "queue_depth": s.queue_depth,
            "current_task": s.current_task,
        }
        for s in _status.values()
    ]


def get_one(agent_id: str) -> dict:
    st = _ensure(agent_id)
    return {
        "agent_id":    st.agent_id,
        "state":       st.state,
        "queue_depth": st.queue_depth,
        "current_task": st.current_task,
    }
