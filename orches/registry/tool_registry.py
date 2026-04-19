"""
Tool registry — discovers builtin tools automatically.
MCP tools are started as subprocesses and registered dynamically.
"""
import importlib
import json
from pathlib import Path

_BUILTIN_DIR = Path(__file__).parent / "tools" / "builtin"
_MCP_DIR     = Path(__file__).parent / "tools" / "mcp"

# name → {"meta": TOOL_META, "execute": fn|None, "type": "builtin"|"mcp", ...}
_registry: dict[str, dict] = {}


def _load_builtins():
    for path in _BUILTIN_DIR.glob("*.py"):
        if path.name.startswith("_"):
            continue
        module_name = f"registry.tools.builtin.{path.stem}"
        mod = importlib.import_module(module_name)
        meta    = getattr(mod, "TOOL_META", None)
        execute = getattr(mod, "execute", None)
        if meta and execute:
            _registry[meta["name"]] = {"meta": meta, "execute": execute, "type": "builtin"}


def load():
    _load_builtins()


# ── MCP ──────────────────────────────────────────────────────────────────────

def _read_mcp_configs() -> list[dict]:
    if not _MCP_DIR.exists():
        return []
    configs = []
    for path in _MCP_DIR.glob("*.json"):
        try:
            with open(path) as f:
                configs.append(json.load(f))
        except Exception:
            pass
    return configs


async def load_mcp(configs: list[dict] | None = None) -> list[str]:
    """Start MCP servers and register their tools. Returns names of started servers."""
    from core.mcp_manager import manager as mcp_manager
    if configs is None:
        configs = _read_mcp_configs()
    started = []
    for config in configs:
        name = config.get("name")
        if not name:
            continue
        ok = await mcp_manager.add_server(config)
        if ok:
            started.append(name)
            for tool in mcp_manager._servers[name].tools:
                _registry[tool["name"]] = {
                    "meta": tool,
                    "execute": None,
                    "type": "mcp",
                    "server": name,
                }
    return started


def save_mcp_config(config: dict):
    _MCP_DIR.mkdir(parents=True, exist_ok=True)
    path = _MCP_DIR / f"{config['name']}.json"
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def delete_mcp_config(name: str):
    path = _MCP_DIR / f"{name}.json"
    if path.exists():
        path.unlink()
    to_remove = [k for k, v in _registry.items() if v.get("server") == name]
    for k in to_remove:
        del _registry[k]


def all_mcp_servers() -> list[dict]:
    from core.mcp_manager import manager as mcp_manager
    return mcp_manager.server_list()


# ── Public API ────────────────────────────────────────────────────────────────

def get(name: str) -> dict | None:
    return _registry.get(name)


def all_tools() -> list[dict]:
    return [v["meta"] for v in _registry.values()]


def all_names() -> list[str]:
    return list(_registry.keys())


async def call(tool_name: str, **kwargs) -> str:
    tool = _registry.get(tool_name)
    if not tool:
        return f"Error: unknown tool '{tool_name}'"
    if tool["type"] == "mcp":
        from core.mcp_manager import manager as mcp_manager
        server, original_name = mcp_manager.get_server_for_tool(tool_name)
        if not server:
            return f"Error: MCP server for tool '{tool_name}' is not running"
        return await server.call_tool(original_name, kwargs)
    return await tool["execute"](**kwargs)
