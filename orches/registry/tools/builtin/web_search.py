from ddgs import DDGS

TOOL_META = {
    "name": "web_search",
    "description": "Search the internet for up-to-date information",
    "type": "builtin",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "max_results": {"type": "integer", "description": "Max results to return (default 5)"},
        },
        "required": ["query"],
    },
}


async def execute(query: str, max_results: int = 5) -> str:
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))

        if not results:
            return "No results found."

        lines = []
        for r in results:
            lines.append(f"**{r['title']}**\n{r['body']}\n{r['href']}")

        return "\n\n".join(lines)

    except Exception as e:
        return f"Search error: {e}"
