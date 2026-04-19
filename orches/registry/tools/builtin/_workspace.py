"""Shared workspace path helper used by all file tools."""
import os
from pathlib import Path


def workspace_root() -> Path:
    raw = os.getenv("WORKSPACE_DIR", "./workspace")
    path = Path(raw)
    if not path.is_absolute():
        # relative to the agent-squad directory
        path = Path(__file__).parent.parent.parent.parent / path.name
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def safe_path(relative: str) -> Path:
    """
    Resolve a relative path inside the workspace.
    Raises ValueError if the path tries to escape the workspace.
    """
    root = workspace_root()
    resolved = (root / relative).resolve()
    if not str(resolved).startswith(str(root)):
        raise ValueError(f"Path '{relative}' is outside the workspace")
    return resolved
