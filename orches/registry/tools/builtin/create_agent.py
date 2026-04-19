"""
create_agent — lets the main agent create new sub-agents at runtime.
"""
import json
from pathlib import Path

AGENTS_DIR = Path(__file__).parent.parent.parent / "agents"

# Tools that sub-agents are allowed to use (cannot grant create_agent itself)
ALLOWED_TOOLS = {
    "workspace_read", "workspace_write", "delegate",
    "memory", "fetch_url", "canvas_open", "web_search",
}

TOOL_META = {
    "name": "create_agent",
    "description": (
        "Create a new sub-agent or update an existing one. "
        "Use this to assemble a team of specialised agents for a complex task. "
        "Returns the created agent's id."
    ),
    "system_prompt_hint": (
        "## Creating agents\n"
        "Use create_agent when the user asks you to build a team, add a specialist, "
        "or create a new agent. Pick a clear snake_case id, write a focused system_prompt, "
        "and assign only the tools the agent actually needs.\n"
        "IMPORTANT: Always write agent name, description, and system_prompt in ENGLISH, "
        "regardless of the language the user used to make the request.\n\n"
        "## Creating a TEAM (2+ agents)\n"
        "Order: create team members FIRST, then create the team lead.\n"
        "Team lead rules:\n"
        "- Always include 'delegate', 'canvas_open', and 'workspace_write' in its tools\n"
        "- Set can_call to ONLY its own team members (not researcher/writer or any other existing agents)\n"
        "- System prompt must say: 'ONLY delegate to: <list their ids>. Never use any other agents.'\n"
        "- System prompt must say: 'Always save long reports to workspace and open in canvas, never dump in chat'\n"
        "After creating the team, add only the team lead to YOUR OWN can_call.\n\n"
        "## Updating yourself\n"
        "To add a new agent to your own can_call, call create_agent with id='main' and the full updated config."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "id": {
                "type": "string",
                "description": "Unique snake_case identifier, e.g. 'data_analyst'",
            },
            "name": {
                "type": "string",
                "description": "Human-readable display name",
            },
            "description": {
                "type": "string",
                "description": "One-line description of the agent's role",
            },
            "system_prompt": {
                "type": "string",
                "description": "Instructions for the agent",
            },
            "tools": {
                "type": "array",
                "items": {"type": "string"},
                "description": f"Tools to give the agent. Allowed: {sorted(ALLOWED_TOOLS)}",
            },
            "can_call": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Agent ids this agent may delegate to (cannot include 'main')",
            },
            "model": {
                "type": "string",
                "description": "Optional model override (e.g. 'claude-haiku-4-5-20251001')",
            },
        },
        "required": ["id", "name", "system_prompt"],
    },
}


async def execute(
    id: str,
    name: str,
    system_prompt: str,
    description: str = "",
    tools: list[str] | None = None,
    can_call: list[str] | None = None,
    model: str | None = None,
    **_,
) -> str:
    from core import engine
    from core.events import emit, AgentEvent

    # Sanitise id
    agent_id = id.strip().replace(" ", "_").lower()
    if not agent_id or agent_id == "main":
        return "Error: invalid agent id."

    # Whitelist tools — never grant create_agent to sub-agents
    safe_tools = [t for t in (tools or []) if t in ALLOWED_TOOLS]

    # Never allow back-delegation to main
    safe_can_call = [a for a in (can_call or []) if a != "main" and a != agent_id]

    config: dict = {
        "id": agent_id,
        "name": name,
        "system_prompt": system_prompt,
        "tools": safe_tools,
        "can_call": safe_can_call,
        "limits": {"timeout_seconds": 90},
    }
    if description:
        config["description"] = description
    if model:
        config["model"] = model

    # Persist to disk
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    path = AGENTS_DIR / f"{agent_id}.agent"
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")

    # Register in engine
    engine.register_agent(config)

    # Notify frontend
    await emit(AgentEvent(
        agent_id="main",
        event_type="agent_created",
        payload={"agent": config},
    ))

    existed = "updated" if path.exists() else "created"
    return f"Agent '{name}' ({agent_id}) {existed} successfully."
