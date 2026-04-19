"""
MCP (Model Context Protocol) server manager.
Manages subprocess-based MCP servers, communicates via JSON-RPC 2.0 over stdio.
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
import re
import shlex

logger = logging.getLogger(__name__)


def _resolve_env(value: str) -> str:
    """Replace ${VAR} with values from os.environ."""
    return re.sub(r"\$\{(\w+)\}", lambda m: os.environ.get(m.group(1), ""), value)


class MCPServer:
    def __init__(self, config: dict):
        self.name: str = config["name"]
        self.command: str = config["command"]
        self.raw_env: dict = config.get("env", {})
        self.tools: list[dict] = []
        self._process: asyncio.subprocess.Process | None = None
        self._req_id = 0

    def _next_id(self) -> int:
        self._req_id += 1
        return self._req_id

    def _build_env(self) -> dict:
        env = os.environ.copy()
        for k, v in self.raw_env.items():
            env[k] = _resolve_env(str(v))
        return env

    async def start(self) -> bool:
        """Launch subprocess, initialize, and list tools. Returns True on success."""
        try:
            parts = shlex.split(self.command)
            self._process = await asyncio.create_subprocess_exec(
                *parts,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=self._build_env(),
            )
        except Exception as e:
            logger.warning("MCP '%s' failed to start: %s", self.name, e)
            return False

        try:
            await self._send({
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "orches", "version": "0.1.0"},
                },
            })
            await self._write({"jsonrpc": "2.0", "method": "notifications/initialized"})
            resp = await self._send({"method": "tools/list"})
            raw_tools = resp.get("result", {}).get("tools", [])
            self.tools = [self._convert_tool(t) for t in raw_tools]
            logger.info("MCP '%s' ready with %d tools", self.name, len(self.tools))
            return True
        except Exception as e:
            logger.warning("MCP '%s' init failed: %s", self.name, e)
            self.stop()
            return False

    def _convert_tool(self, t: dict) -> dict:
        """Convert MCP tool schema → internal format. Name is prefixed with server name.
        If the tool name is already contained in the server name, skip the suffix."""
        original = t["name"]
        full_name = self.name if original in self.name else f"{self.name}__{original}"
        return {
            "name": full_name,
            "description": t.get("description", ""),
            "input_schema": t.get("inputSchema", {"type": "object", "properties": {}}),
            "_mcp_original": t["name"],
            "_mcp_server": self.name,
        }

    async def call_tool(self, original_name: str, arguments: dict) -> str:
        try:
            resp = await self._send({
                "method": "tools/call",
                "params": {"name": original_name, "arguments": arguments},
            })
            if "error" in resp:
                return f"Error: {resp['error'].get('message', str(resp['error']))}"
            content = resp.get("result", {}).get("content", [])
            parts = [item["text"] for item in content if item.get("type") == "text"]
            return "\n".join(parts) if parts else ""
        except Exception as e:
            return f"Error calling MCP tool '{original_name}': {e}"

    async def _send(self, payload: dict) -> dict:
        req_id = self._next_id()
        await self._write({"jsonrpc": "2.0", "id": req_id, **payload})
        return await self._read(req_id)

    async def _write(self, msg: dict):
        line = json.dumps(msg) + "\n"
        self._process.stdin.write(line.encode())
        await self._process.stdin.drain()

    async def _read(self, expected_id: int) -> dict:
        while True:
            line = await asyncio.wait_for(self._process.stdout.readline(), timeout=15.0)
            if not line:
                raise RuntimeError("MCP server closed stdout")
            try:
                msg = json.loads(line.decode().strip())
            except json.JSONDecodeError:
                continue
            # Skip notifications (no id) — wait for the response with matching id
            if msg.get("id") == expected_id:
                return msg

    def stop(self):
        if self._process:
            try:
                self._process.terminate()
            except Exception:
                pass
            self._process = None

    def status(self) -> str:
        return "running" if self._process else "stopped"


class MCPManager:
    def __init__(self):
        self._servers: dict[str, MCPServer] = {}

    async def add_server(self, config: dict) -> bool:
        name = config["name"]
        if name in self._servers:
            self._servers[name].stop()
        server = MCPServer(config)
        ok = await server.start()
        if ok:
            self._servers[name] = server
        return ok

    def remove_server(self, name: str):
        if name in self._servers:
            self._servers[name].stop()
            del self._servers[name]

    def get_server_for_tool(self, namespaced_name: str) -> tuple[MCPServer | None, str]:
        """Return (server, original_tool_name) for a namespaced tool name."""
        for server in self._servers.values():
            for tool in server.tools:
                if tool["name"] == namespaced_name:
                    return server, tool["_mcp_original"]
        return None, namespaced_name

    def all_tools(self) -> list[dict]:
        result = []
        for server in self._servers.values():
            result.extend(server.tools)
        return result

    def server_list(self) -> list[dict]:
        return [
            {
                "name": s.name,
                "command": s.command,
                "tools_count": len(s.tools),
                "status": s.status(),
                "tools": [t["name"] for t in s.tools],
            }
            for s in self._servers.values()
        ]

    def stop_all(self):
        for server in self._servers.values():
            server.stop()


manager = MCPManager()
