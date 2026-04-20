"""
rag — Retrieval-Augmented Generation tool.

Actions:
  ingest  — chunk text and store with embeddings
  search  — semantic (or keyword) search over stored chunks
  delete  — remove all chunks for a collection
  list    — list available collections with chunk counts
"""
import json
from core.database import SessionLocal, RagChunkModel
from core.embeddings import get_embedding, cosine_similarity

TOOL_META = {
    "name": "rag",
    "description": (
        "Knowledge base: ingest documents and search them semantically. "
        "Use 'ingest' to add text, 'search' to find relevant chunks, "
        "'delete' to clear a collection, 'list' to see available collections."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["ingest", "search", "delete", "list"],
                "description": "Operation to perform.",
            },
            "text": {
                "type": "string",
                "description": "Text to ingest (required for ingest).",
            },
            "source": {
                "type": "string",
                "description": "Label or filename for the ingested text (required for ingest).",
            },
            "query": {
                "type": "string",
                "description": "Search query (required for search).",
            },
            "collection": {
                "type": "string",
                "description": "Collection name to scope ingestion/search. Default: 'default'.",
                "default": "default",
            },
            "top_k": {
                "type": "integer",
                "description": "Number of top results to return for search. Default: 5.",
                "default": 5,
            },
        },
        "required": ["action"],
    },
}

_CHUNK_SIZE    = 800
_CHUNK_OVERLAP = 150


def _split_chunks(text: str) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        end = start + _CHUNK_SIZE
        chunks.append(text[start:end].strip())
        start += _CHUNK_SIZE - _CHUNK_OVERLAP
    return [c for c in chunks if c]


async def execute(
    action: str,
    text: str = "",
    source: str = "",
    query: str = "",
    collection: str = "default",
    top_k: int = 5,
    **_,
) -> str:

    with SessionLocal() as db:

        # ── ingest ────────────────────────────────────────────────────────────
        if action == "ingest":
            if not text:
                return "Error: 'ingest' requires 'text'."
            if not source:
                source = "untitled"

            # Remove existing chunks for this source in this collection
            db.query(RagChunkModel).filter_by(collection=collection, source=source).delete()
            db.commit()

            chunks = _split_chunks(text)
            for i, chunk in enumerate(chunks):
                embedding = await get_embedding(chunk)
                db.add(RagChunkModel(
                    collection=collection,
                    source=source,
                    chunk_index=i,
                    text=chunk,
                    embedding=json.dumps(embedding) if embedding else None,
                ))
            db.commit()
            return f"Ingested {len(chunks)} chunks from '{source}' into collection '{collection}'."

        # ── search ────────────────────────────────────────────────────────────
        if action == "search":
            if not query:
                return "Error: 'search' requires 'query'."

            rows = db.query(RagChunkModel).filter_by(collection=collection).all()
            if not rows:
                return f"Collection '{collection}' is empty."

            query_embedding = await get_embedding(query)
            rows_with_emb = [r for r in rows if r.embedding]

            if query_embedding and rows_with_emb:
                scored = sorted(
                    rows_with_emb,
                    key=lambda r: cosine_similarity(query_embedding, json.loads(r.embedding)),
                    reverse=True,
                )[:top_k]
            else:
                # Keyword fallback
                ql = query.lower()
                scored = [r for r in rows if ql in r.text.lower()][:top_k]

            if not scored:
                return "No relevant chunks found."

            parts = []
            for r in scored:
                parts.append(f"[{r.source} #{r.chunk_index}]\n{r.text}")
            return "\n\n---\n\n".join(parts)

        # ── delete ────────────────────────────────────────────────────────────
        if action == "delete":
            deleted = db.query(RagChunkModel).filter_by(collection=collection).delete()
            db.commit()
            return f"Deleted {deleted} chunks from collection '{collection}'."

        # ── list ──────────────────────────────────────────────────────────────
        if action == "list":
            from sqlalchemy import func
            rows = (
                db.query(RagChunkModel.collection, func.count(RagChunkModel.id))
                .group_by(RagChunkModel.collection)
                .all()
            )
            if not rows:
                return "No collections found."
            return "\n".join(f"• {col}: {cnt} chunks" for col, cnt in rows)

    return "Unknown action."
