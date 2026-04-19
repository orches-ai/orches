from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import registry.tool_registry as tool_registry

router = APIRouter(prefix="/registry", tags=["registry"])


@router.get("/tools")
def list_tools():
    return tool_registry.all_tools()


@router.get("/mcp")
def list_mcp():
    return tool_registry.all_mcp_servers()


class MCPServerConfig(BaseModel):
    name: str
    command: str
    env: dict = {}


@router.post("/mcp")
async def add_mcp(body: MCPServerConfig):
    config = {"name": body.name, "command": body.command, "env": body.env}
    tool_registry.save_mcp_config(config)
    started = await tool_registry.load_mcp([config])
    if body.name not in started:
        raise HTTPException(
            status_code=400,
            detail=f"MCP server '{body.name}' failed to start. Check the command and try again.",
        )
    from core.mcp_manager import manager as mcp_manager
    tools_count = len(mcp_manager._servers[body.name].tools)
    return {"status": "started", "name": body.name, "tools_count": tools_count}


@router.delete("/mcp/{name}")
def remove_mcp(name: str):
    from core.mcp_manager import manager as mcp_manager
    mcp_manager.remove_server(name)
    tool_registry.delete_mcp_config(name)
    return {"status": "removed", "name": name}
