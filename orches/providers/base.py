from abc import ABC, abstractmethod
from typing import AsyncIterator


class ModelProvider(ABC):

    @abstractmethod
    async def run(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        """Send messages and return full response text."""
        ...

    @abstractmethod
    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        """Send messages and stream response chunks."""
        ...
