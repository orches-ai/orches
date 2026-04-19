"""
canvas_open — show rich content to the user in a Canvas overlay.
The engine injects _agent_id before calling execute().
"""

TOOL_META = {
    "name": "canvas_open",
    "description": (
        "Show formatted content to the user in a full-screen canvas overlay. "
        "Use 'markdown' for reports. 'code' for source files. "
        "'table' for tabular data. 'chart' for visualising data as a graph. "
        "'browser' to show a website."
    ),
    "system_prompt_hint": (
        "## When to use canvas_open\n"
        "Prefer canvas_open over a plain text reply when the result is:\n"
        "- Tabular data with more than ~5 rows → use type='table' with data as JSON array of objects\n"
        "- Time-series, comparisons, distributions, rankings → use type='chart'\n"
        "- A structured report or document → type='markdown'\n"
        "- Code longer than a few lines → type='code'\n\n"
        "For type='table' or type='chart': pass data as a JSON string — array of objects.\n"
        "For type='chart' also pass chart_type: 'line' | 'bar' | 'area' | 'pie' | 'scatter'.\n"
        "Chart data example (line/bar/area): '[{\"date\":\"Jan\",\"price\":42000},{\"date\":\"Feb\",\"price\":45000}]'\n"
        "Chart data example (pie): '[{\"name\":\"BTC\",\"value\":57},{\"name\":\"ETH\",\"value\":18}]'\n"
        "The user does NOT need to explicitly ask for canvas — use your judgment."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "type":       {"type": "string", "enum": ["markdown", "code", "browser", "table", "chart"], "description": "Page type"},
            "title":      {"type": "string", "description": "Tab title shown in the canvas header"},
            "content":    {"type": "string", "description": "Text content for markdown or code types"},
            "language":   {"type": "string", "description": "Language hint for code type (e.g. python, json)"},
            "url":        {"type": "string", "description": "URL for browser type"},
            "data":       {"type": "string", "description": "JSON string — array of objects for table or chart types"},
            "chart_type": {"type": "string", "enum": ["line", "bar", "area", "pie", "scatter"], "description": "Chart variant (required for type='chart')"},
        },
        "required": ["type", "title"],
    },
}

_agent_id: str = "system"


def set_agent_id(agent_id: str):
    global _agent_id
    _agent_id = agent_id


async def execute(
    type: str,
    title: str,
    content: str = "",
    language: str = "",
    url: str = "",
    data: str = "",
    chart_type: str = "line",
) -> str:
    from core.events import emit, AgentEvent
    await emit(AgentEvent(
        agent_id=_agent_id,
        event_type="canvas_open",
        payload={
            "type": type,
            "title": title,
            "content": content,
            "language": language,
            "url": url,
            "data": data,
            "chart_type": chart_type,
        },
    ))
    return f"Canvas page '{title}' opened."
