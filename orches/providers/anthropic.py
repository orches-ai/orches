import os
from typing import AsyncIterator
import anthropic

from .base import ModelProvider


class AnthropicProvider(ModelProvider):

    def __init__(self, model: str = "claude-sonnet-4-5"):
        self.model = model
        self.client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    async def run(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        kwargs = {"model": self.model, "max_tokens": 4096, "messages": messages}
        if tools:
            kwargs["tools"] = tools

        response = await self.client.messages.create(**kwargs)
        return response.content[0].text

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        async with self.client.messages.stream(
            model=self.model,
            max_tokens=4096,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text
