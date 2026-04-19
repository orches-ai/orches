TOOL_META = {
    "name": "delegate",
    "description": (
        "Delegate a task to a specialized sub-agent. "
        "Use this when a task requires research, writing, or other specialized work. "
        "Available agents: researcher (web search, reading files), writer (writing content)."
    ),
    "type": "builtin",
    "input_schema": {
        "type": "object",
        "properties": {
            "agent_id": {
                "type": "string",
                "description": "ID of the agent to delegate to (researcher | writer)"
            },
            "task": {
                "type": "string",
                "description": "Clear description of what the agent should do"
            }
        },
        "required": ["agent_id", "task"],
    },
}


async def execute(agent_id: str, task: str) -> str:
    # Actual delegation is handled by the engine loop directly.
    # This module only exists so the tool is registered and visible to the model.
    return f"Delegating to {agent_id}: {task}"
