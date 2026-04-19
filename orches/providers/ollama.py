import os
import json
from typing import AsyncIterator
import httpx

from .base import ModelProvider


class OllamaProvider(ModelProvider):

    def __init__(self, model: str = "llama3"):
        self.model = model
        self.base_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.num_ctx = int(os.getenv("OLLAMA_NUM_CTX", 4096))

    def _options(self) -> dict:
        return {"num_ctx": self.num_ctx}

    async def run(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                    "options": self._options(),
                },
            )
            response.raise_for_status()
            return response.json()["message"]["content"]

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": True,
                    "options": self._options(),
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        data = json.loads(line)
                        content = data.get("message", {}).get("content", "")
                        if content:
                            yield content
                        if data.get("done"):
                            break
