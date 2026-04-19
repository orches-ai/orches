from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
import re
import core.app_settings as app_settings
import core.provider_keys as provider_keys

router = APIRouter(prefix="/settings", tags=["settings"])

ENV_PATH = Path(__file__).parent.parent.parent / ".env"

# Only expose these keys — never DATABASE_URL or other infra secrets
ALLOWED_ENV_KEYS = {
    "PROVIDER", "LOCAL_MODEL",
    "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
    "OPENAI_API_KEY", "OPENAI_MODEL",
    "OLLAMA_URL", "OLLAMA_NUM_CTX",
    "WORKSPACE_DIR",
    "MAX_CONCURRENT_AGENTS", "MAX_DELEGATION_DEPTH",
    "MAX_ITERATIONS", "MAX_TOOL_RETRIES", "TIMEOUT_SECONDS",
}


def _read_env() -> dict[str, str]:
    result: dict[str, str] = {}
    if not ENV_PATH.exists():
        return result
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r'^([A-Z_][A-Z0-9_]*)=(.*)$', line)
        if m:
            key, val = m.group(1), m.group(2).split("#")[0].strip()
            if key in ALLOWED_ENV_KEYS:
                result[key] = val
    return result


def _write_env(updates: dict[str, str]):
    if not ENV_PATH.exists():
        return
    lines = ENV_PATH.read_text().splitlines()
    updated_keys: set[str] = set()
    new_lines = []
    for line in lines:
        m = re.match(r'^([A-Z_][A-Z0-9_]*)=', line.strip())
        if m and m.group(1) in updates:
            key = m.group(1)
            new_lines.append(f"{key}={updates[key]}")
            updated_keys.add(key)
        else:
            new_lines.append(line)
    ENV_PATH.write_text("\n".join(new_lines) + "\n")


@router.get("")
def get_settings():
    return app_settings.get_all()


class SettingsPatch(BaseModel):
    auto_summarize: bool | None = None
    summarize_threshold: int | None = None
    no_emojis: bool | None = None
    research_depth: int | None = None


@router.patch("")
def patch_settings(body: SettingsPatch):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return app_settings.update(patch)


_ENV_DEFAULTS = {
    "MAX_CONCURRENT_AGENTS": "5",
    "MAX_DELEGATION_DEPTH":  "3",
    "MAX_ITERATIONS":        "10",
    "TIMEOUT_SECONDS":       "300",
    "WORKSPACE_DIR":         "./workspace",
}


@router.get("/env")
def get_env():
    return {**_ENV_DEFAULTS, **_read_env()}


class EnvPatch(BaseModel):
    values: dict[str, str]


@router.patch("/env")
def patch_env(body: EnvPatch):
    safe = {k: v for k, v in body.values.items() if k in ALLOWED_ENV_KEYS}
    _write_env(safe)
    return _read_env()


# ── Provider keys ─────────────────────────────────────────────────────────────

class ProviderKeyCreate(BaseModel):
    provider: str
    label: str
    key: str = ""
    url: str = ""
    base_url: str = ""
    model: str = ""


class ProviderKeyUpdate(BaseModel):
    label: str | None = None
    key: str | None = None
    url: str | None = None
    base_url: str | None = None
    model: str | None = None


@router.get("/providers")
def list_providers():
    return provider_keys.get_all(masked=True)


@router.post("/providers")
def create_provider(body: ProviderKeyCreate):
    return provider_keys.add(
        provider=body.provider,
        label=body.label,
        key=body.key,
        url=body.url,
        base_url=body.base_url,
        model=body.model,
    )


@router.patch("/providers/{key_id}")
def update_provider(key_id: str, body: ProviderKeyUpdate):
    result = provider_keys.update(key_id, **body.model_dump())
    if result is None:
        raise HTTPException(404, "Provider key not found")
    return result


@router.delete("/providers/{key_id}")
def delete_provider(key_id: str):
    if not provider_keys.delete(key_id):
        raise HTTPException(404, "Provider key not found")
    return {"ok": True}
