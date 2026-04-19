import os
from .base import ModelProvider
from .anthropic import AnthropicProvider
from .openai import OpenAIProvider
from .ollama import OllamaProvider

# Default models per provider — ollama is resolved lazily so .env is read at call time
_DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-4-6",
    "openai":    "gpt-4o",
}


def default_provider() -> tuple[str, str]:
    """Return (provider_name, model) from environment. Always reads .env values fresh."""
    provider = os.getenv("PROVIDER", "ollama")
    if provider == "ollama":
        model = os.getenv("LOCAL_MODEL", "llama3")
    elif provider == "anthropic":
        model = os.getenv("ANTHROPIC_MODEL", _DEFAULT_MODELS["anthropic"])
    elif provider == "openai":
        model = os.getenv("OPENAI_MODEL", _DEFAULT_MODELS["openai"])
    else:
        model = _DEFAULT_MODELS.get(provider, "llama3")
    return provider, model


def make_provider(provider_name: str | None, model: str | None) -> ModelProvider:
    """
    Build a provider instance.
    If provider_name or model is None, fall back to env defaults.
    """
    if not provider_name or not model:
        env_provider, env_model = default_provider()
        provider_name = provider_name or env_provider
        model = model or env_model

    # For ollama, always pick LOCAL_MODEL from env if model wasn't explicitly set
    if provider_name == "ollama":
        model = model or os.getenv("LOCAL_MODEL", "llama3")

    match provider_name:
        case "anthropic":
            return AnthropicProvider(model=model)
        case "openai":
            return OpenAIProvider(model=model)
        case "ollama":
            return OllamaProvider(model=model)
        case _:
            raise ValueError(f"Unknown provider: {provider_name}")


def make_provider_from_key(key_entry: dict, model_override: str | None = None) -> ModelProvider:
    """Build a provider from a stored provider_key entry (unmasked)."""
    provider = key_entry["provider"]
    model = model_override or key_entry.get("model") or _DEFAULT_MODELS.get(provider, "llama3")

    match provider:
        case "anthropic":
            p = AnthropicProvider(model=model)
            if key_entry.get("key"):
                import anthropic as _anthropic
                p.client = _anthropic.AsyncAnthropic(api_key=key_entry["key"])
            return p
        case "openai":
            p = OpenAIProvider(model=model)
            if key_entry.get("key"):
                from openai import AsyncOpenAI
                p.client = AsyncOpenAI(api_key=key_entry["key"])
            return p
        case "ollama":
            p = OllamaProvider(model=model)
            if key_entry.get("url"):
                p.base_url = key_entry["url"]
            return p
        case _:
            raise ValueError(f"Unknown provider: {provider}")
