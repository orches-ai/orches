"""
Persistent store for provider API keys.
Saved to data/provider_keys.json — excluded from git via .gitignore.
"""
import json
import uuid
from pathlib import Path

_PATH = Path(__file__).parent.parent / "data" / "provider_keys.json"


def _load() -> list[dict]:
    if not _PATH.exists():
        return []
    try:
        return json.loads(_PATH.read_text())
    except Exception:
        return []


def _save(keys: list[dict]):
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    _PATH.write_text(json.dumps(keys, indent=2))


def _mask(key: str) -> str:
    if not key or len(key) < 8:
        return "***"
    return key[:8] + "..." + key[-4:]


def get_all(masked: bool = True) -> list[dict]:
    keys = _load()
    if not masked:
        return keys
    return [{**k, "key": _mask(k.get("key", ""))} for k in keys]


def get_by_id(key_id: str) -> dict | None:
    return next((k for k in _load() if k["id"] == key_id), None)


def get_by_provider(provider: str) -> dict | None:
    """Return first stored key for given provider (fallback when no key_id assigned)."""
    return next((k for k in _load() if k["provider"] == provider), None)


def add(provider: str, label: str, key: str = "", url: str = "", model: str = "", base_url: str = "") -> dict:
    keys = _load()
    entry = {
        "id":       str(uuid.uuid4()),
        "provider": provider,
        "label":    label,
        "key":      key,
        "url":      url,        # ollama server url
        "base_url": base_url,   # openai-compatible base url for other providers
        "model":    model,
    }
    keys.append(entry)
    _save(keys)
    return {**entry, "key": _mask(entry["key"])}


def update(key_id: str, **fields) -> dict | None:
    keys = _load()
    for i, k in enumerate(keys):
        if k["id"] == key_id:
            keys[i] = {**k, **{f: v for f, v in fields.items() if v is not None}}
            _save(keys)
            masked = dict(keys[i])
            masked["key"] = _mask(masked.get("key", ""))
            return masked
    return None


def delete(key_id: str) -> bool:
    keys = _load()
    new_keys = [k for k in keys if k["id"] != key_id]
    if len(new_keys) == len(keys):
        return False
    _save(new_keys)
    return True
