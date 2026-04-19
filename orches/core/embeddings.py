"""
Embedding generation — used for semantic memory search.

Provider priority:
  1. OpenAI  (OPENAI_API_KEY set, any PROVIDER)  → text-embedding-3-small, 1536 dims
  2. Ollama  (PROVIDER=ollama)                    → EMBEDDING_MODEL, variable dims
  3. None    → fallback to ILIKE search
"""
import os
import math

EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "1536"))


async def get_embedding(text: str) -> list[float] | None:
    """Return embedding vector or None if no provider is configured."""
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key and not openai_key.startswith("sk-..."):
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=openai_key)
            model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
            resp = await client.embeddings.create(model=model, input=text)
            return resp.data[0].embedding
        except Exception:
            pass

    if os.getenv("PROVIDER") == "ollama":
        try:
            import httpx
            model = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
            url = os.getenv("OLLAMA_URL", "http://localhost:11434")
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(f"{url}/api/embeddings",
                                         json={"model": model, "prompt": text})
                return resp.json()["embedding"]
        except Exception:
            pass

    return None


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = math.sqrt(sum(x * x for x in a))
    nb  = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0
