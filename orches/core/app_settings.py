"""
Persistent app-level settings stored in data/app_settings.json.
"""
import json
from pathlib import Path

_SETTINGS_FILE = Path(__file__).parent.parent / "data" / "app_settings.json"

_DEFAULTS: dict = {
    "auto_summarize": False,
    "summarize_threshold": 20,
    "no_emojis": False,
    "research_depth": 2,  # 1=quick (2-3 sources), 2=normal (5-7), 3=deep (10+)
}


def _load() -> dict:
    if _SETTINGS_FILE.exists():
        try:
            return {**_DEFAULTS, **json.loads(_SETTINGS_FILE.read_text())}
        except Exception:
            pass
    return dict(_DEFAULTS)


def _save(data: dict):
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(json.dumps(data, indent=2))


def get_all() -> dict:
    return _load()


def get(key: str):
    return _load().get(key, _DEFAULTS.get(key))


def update(patch: dict) -> dict:
    data = _load()
    data.update({k: v for k, v in patch.items() if k in _DEFAULTS})
    _save(data)
    return data
