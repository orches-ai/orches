from ._workspace import workspace_root, safe_path

TOOL_META = {
    "name": "workspace_read",
    "description": "Browse and read files in the shared workspace. Use action='list' to explore folders, action='read' to get file contents. When the user's message contains [file: some/path], call this tool with action='read' and path='some/path'.",
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "read"],
                "description": "list: show folder contents; read: get file content as text",
            },
            "path": {
                "type": "string",
                "description": "Relative path in workspace (empty string = workspace root)",
            },
        },
        "required": ["action"],
    },
}


async def execute(action: str, path: str = "") -> str:
    root = workspace_root()

    if action == "list":
        target = safe_path(path) if path else root
        if not target.exists():
            return f"Path not found: {path}"
        if not target.is_dir():
            return f"Not a directory: {path}"
        items = sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        lines = []
        for item in items:
            if item.name.startswith("."):
                continue
            rel = item.relative_to(root)
            kind = "file" if item.is_file() else "dir"
            size = f"  ({item.stat().st_size} bytes)" if item.is_file() else ""
            lines.append(f"{kind}  {rel}{size}")
        return "\n".join(lines) if lines else f"Empty: {path or 'workspace'}"

    if action == "read":
        if not path:
            return "Error: path is required for read"
        try:
            target = safe_path(path)
        except ValueError as e:
            return f"Error: {e}"
        if not target.exists():
            return f"File not found: {path}"
        if not target.is_file():
            return f"Not a file: {path}"
        try:
            return target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return f"[Binary file: {path}, {target.stat().st_size} bytes — cannot read as text]"

    return f"Unknown action: {action}"
