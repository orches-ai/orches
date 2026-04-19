"""
memory_tool — persistent agent memory with scoped access.

Actions:
  remember  — store a key/value pair (+ generates semantic embedding)
  recall    — semantic search if embedding available, else ILIKE fallback
  forget    — delete a memory by key
"""
from datetime import datetime, timezone
from core.database import SessionLocal, AgentMemoryModel
from core.embeddings import get_embedding, cosine_similarity

TOOL_META = {
    "name": "memory",
    "description": (
        "Store and retrieve persistent memories across conversations. "
        "Use 'remember' to save facts, 'recall' to search memories, 'forget' to delete."
    ),
    "system_prompt_hint": (
        "Memory tool: when the user asks to save, remember, or store anything — "
        "ALWAYS call memory(action='remember', scope='global', key='...', value='...'). "
        "Never confirm saving without calling the tool."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["remember", "recall", "forget"],
                "description": "The memory operation to perform.",
            },
            "key": {
                "type": "string",
                "description": "Memory key (required for remember/forget).",
            },
            "value": {
                "type": "string",
                "description": "Value to store (required for remember).",
            },
            "query": {
                "type": "string",
                "description": "Search term for recall — semantic search when possible.",
            },
            "scope": {
                "type": "string",
                "enum": ["agent", "global"],
                "description": "Memory scope: 'agent' (private) or 'global' (shared). Default: agent.",
                "default": "agent",
            },
        },
        "required": ["action"],
    },
}

_INJECTED_AGENT_ID: str | None = None


def set_agent_id(agent_id: str) -> None:
    global _INJECTED_AGENT_ID
    _INJECTED_AGENT_ID = agent_id


async def execute(action: str, key: str = "", value: str = "",
                  query: str = "", scope: str = "agent", **_) -> str:
    agent_id = _INJECTED_AGENT_ID or "unknown"

    with SessionLocal() as db:

        if action == "remember":
            if not key or not value:
                return "Error: 'remember' requires both 'key' and 'value'."

            embedding = await get_embedding(f"{key}: {value}")

            stored_agent_id = agent_id if scope == "agent" else "global"
            existing = (
                db.query(AgentMemoryModel)
                .filter_by(agent_id=stored_agent_id, scope=scope, key=key)
                .first()
            )
            if existing:
                existing.value = value
                existing.embedding = embedding
                existing.updated_at = datetime.now(timezone.utc)
            else:
                db.add(AgentMemoryModel(
                    agent_id=stored_agent_id, scope=scope,
                    key=key, value=value, embedding=embedding,
                ))
            db.commit()
            return f"Remembered: {key} = {value}"

        if action == "recall":
            term = query or key

            # Load candidates
            q = db.query(AgentMemoryModel)
            if scope == "agent":
                q = q.filter(
                    (AgentMemoryModel.agent_id == agent_id) |
                    (AgentMemoryModel.scope == "global")
                )
            rows = q.all()

            if not rows:
                return "No memories found."

            # Semantic search if query provided and embeddings exist
            if term:
                query_embedding = await get_embedding(term)
                rows_with_embedding = [r for r in rows if r.embedding is not None]

                if query_embedding and rows_with_embedding:
                    scored = sorted(
                        rows_with_embedding,
                        key=lambda r: cosine_similarity(query_embedding, list(r.embedding)),
                        reverse=True
                    )
                    rows = scored[:10]
                else:
                    # Fallback to ILIKE
                    rows = [
                        r for r in rows
                        if term.lower() in r.key.lower() or term.lower() in r.value.lower()
                    ][:10]

            else:
                rows = rows[:10]

            if not rows:
                return "No memories found."
            return "\n".join(f"[{r.scope}] {r.key}: {r.value}" for r in rows)

        if action == "forget":
            if not key:
                return "Error: 'forget' requires 'key'."
            stored_agent_id = agent_id if scope == "agent" else "global"
            deleted = (
                db.query(AgentMemoryModel)
                .filter_by(agent_id=stored_agent_id, scope=scope, key=key)
                .delete()
            )
            db.commit()
            return f"Forgotten {deleted} memory entry." if deleted else "Memory not found."

    return "Unknown action."
