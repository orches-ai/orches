import mimetypes
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from fastapi import Query

from registry.tools.builtin._workspace import workspace_root, safe_path

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("/list")
def list_folder(path: str = Query(default="")):
    root = workspace_root()
    target = safe_path(path) if path else root
    if not target.exists():
        raise HTTPException(404, f"Path not found: {path}")
    if not target.is_dir():
        raise HTTPException(400, f"Not a directory: {path}")
    items = []
    for item in sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
        if item.name.startswith("."):
            continue
        rel = str(item.relative_to(root))
        items.append({
            "name": item.name,
            "path": rel,
            "type": "file" if item.is_file() else "dir",
            "size": item.stat().st_size if item.is_file() else None,
        })
    return items


@router.get("/file")
def get_file(path: str = Query(...)):
    try:
        target = safe_path(path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"File not found: {path}")
    try:
        return {"content": target.read_text(encoding="utf-8")}
    except UnicodeDecodeError:
        raise HTTPException(400, "Binary file — use /workspace/raw")


@router.get("/raw")
def get_raw(path: str = Query(...)):
    try:
        target = safe_path(path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not target.exists() or not target.is_file():
        raise HTTPException(404)
    content_type, _ = mimetypes.guess_type(str(target))
    return Response(content=target.read_bytes(), media_type=content_type or "application/octet-stream")


@router.post("/upload")
async def upload_file(path: str = Query(default=""), file: UploadFile = File(...)):
    root = workspace_root()
    dest_dir = safe_path(path) if path else root
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = file.filename or "upload"
    dest = dest_dir / filename
    # Verify dest stays inside workspace
    try:
        safe_path(str(dest.relative_to(root)))
    except ValueError as e:
        raise HTTPException(400, str(e))
    data = await file.read()
    dest.write_bytes(data)
    return {"path": str(dest.relative_to(root)), "size": len(data)}


@router.delete("/file")
def delete_file(path: str = Query(...)):
    try:
        target = safe_path(path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not target.exists():
        raise HTTPException(404, f"Not found: {path}")
    if target.is_dir():
        import shutil
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"deleted": path}
