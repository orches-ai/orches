import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from core import events as bus
from core.events import AgentEvent

router = APIRouter(tags=["websocket"])

# Active WebSocket connections
_connections: list[WebSocket] = []
_agent_connections: dict[str, list[WebSocket]] = {}


async def _broadcast(event: AgentEvent):
    message = json.dumps({
        "agent_id": event.agent_id,
        "event_type": event.event_type,
        "payload": event.payload,
        "timestamp": event.timestamp,
    })
    dead = []
    for ws in list(_connections):
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _connections.remove(ws)

    # Per-agent subscribers
    for ws in list(_agent_connections.get(event.agent_id, [])):
        try:
            await ws.send_text(message)
        except Exception:
            _agent_connections[event.agent_id].remove(ws)


# Register broadcast handler once
bus.subscribe(_broadcast)


@router.websocket("/ws/events")
async def ws_all_events(websocket: WebSocket):
    await websocket.accept()
    _connections.append(websocket)
    try:
        while True:
            await asyncio.sleep(30)
            await websocket.send_text('{"type":"ping"}')
    except WebSocketDisconnect:
        _connections.remove(websocket)


@router.websocket("/ws/agent/{agent_id}")
async def ws_agent_events(websocket: WebSocket, agent_id: str):
    await websocket.accept()
    _agent_connections.setdefault(agent_id, []).append(websocket)
    try:
        while True:
            await asyncio.sleep(30)
            await websocket.send_text('{"type":"ping"}')
    except WebSocketDisconnect:
        conns = _agent_connections.get(agent_id, [])
        if websocket in conns:
            conns.remove(websocket)
