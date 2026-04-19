import os
from typing import AsyncIterator
from openai import AsyncOpenAI

from .base import ModelProvider


class OpenAIProvider(ModelProvider):

    def __init__(self, model: str = "gpt-4o"):
        self.model = model
        self.client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    async def run(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        kwargs = {"model": self.model, "messages": messages}
        if tools:
            kwargs["tools"] = tools

        response = await self.client.chat.completions.create(**kwargs)
        return response.choices[0].message.content

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
