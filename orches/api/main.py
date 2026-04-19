from dotenv import load_dotenv
load_dotenv()  # must be first — before any os.getenv calls in imported modules

from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.requests import Request
from contextlib import asynccontextmanager

from core.database import init_db
from core.engine import load_agents_dir
from core import scheduler
import registry.tool_registry as tool_registry

from api.routes.agents import router as agents_router
from api.routes.registry import router as registry_router
from api.routes.ws import router as ws_router
from api.routes.runs import router as runs_router
from api.routes.workspace import router as workspace_router
from api.routes.settings import router as settings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    tool_registry.load()
    await tool_registry.load_mcp()
    load_agents_dir()
    scheduler.start()
    print("orches ready")
    yield
    scheduler.stop()
    from core.mcp_manager import manager as mcp_manager
    mcp_manager.stop_all()


app = FastAPI(title="orches", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"},
    )


app.include_router(agents_router)
app.include_router(registry_router)
app.include_router(ws_router)
app.include_router(runs_router)
app.include_router(workspace_router)
app.include_router(settings_router)


@app.get("/healthz")
def health():
    return {"status": "ok", "app": "orches"}

# Serve built frontend (production / Docker)
_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

    @app.get("/")
    def spa_root():
        return FileResponse(str(_DIST / "index.html"))

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(str(_DIST / "index.html"))
else:
    @app.get("/")
    def root():
        return {"status": "ok", "app": "orches"}
