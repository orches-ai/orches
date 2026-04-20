from ._workspace import workspace_root, safe_path

TOOL_META = {
    "name": "workspace_write",
    "description": "Create, update, or delete files and folders in the shared workspace.",
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["write", "delete", "mkdir"],
                "description": "write: create/overwrite a file; delete: remove file or folder; mkdir: create folder",
            },
            "path": {
                "type": "string",
                "description": "Relative path in workspace. For mkdir, use a plain folder name without file extensions (e.g. 'reports/bitcoin' not 'reports/bitcoin.md').",
            },
            "content": {
                "type": "string",
                "description": "File content (required for write)",
            },
        },
        "required": ["action", "path"],
    },
}


async def execute(action: str, path: str, content: str = "") -> str:
    try:
        target = safe_path(path)
    except ValueError as e:
        return f"Error: {e}"

    if action == "write":
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"Written {len(content)} bytes → {path}"

    if action == "delete":
        if not target.exists():
            return f"Not found: {path}"
        if target.is_dir():
            import shutil
            shutil.rmtree(target)
            return f"Deleted folder: {path}"
        target.unlink()
        return f"Deleted: {path}"

    if action == "mkdir":
        target.mkdir(parents=True, exist_ok=True)
        return f"Created folder: {path}"

    return f"Unknown action: {action}"
