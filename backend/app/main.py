import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from app.graph import graph
from app.knowledge.runbook_store import seed_if_empty
from app import webhook, live_store

# Directory where the built React app lives (set via STATIC_DIR env var).
# In production (Render) this is ./static (populated by build.sh).
# In local dev it is unset / missing, so static serving is skipped.
STATIC_DIR = Path(os.getenv("STATIC_DIR", "./static"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed the runbook vector DB once on startup (downloads embedding model first time).
    n = seed_if_empty()
    print(f"[startup] runbook store ready (added {n} docs).")
    yield


app = FastAPI(title="Netra.ai — Incident Analysis Suite", lifespan=lifespan)

# CORS_ORIGINS env var: comma-separated list of allowed origins.
# In production set it to your deployed frontend URL (or "*" for open access).
# Defaults to localhost for local dev.
_cors_origins_raw = os.getenv("CORS_ORIGINS", "http://localhost:5173")
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


def _jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if isinstance(obj, list):
        return [_jsonable(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    return obj


def _merge_update(final: dict, update: dict) -> None:
    """Fold a streamed node update into the accumulated final state."""
    for key, value in update.items():
        if key == "trace":
            final.setdefault("trace", []).extend(value or [])
        else:
            final[key] = value


def _parse_expertise(raw: str) -> list[str]:
    return [e.strip() for e in (raw or "").split(",") if e.strip()]


# ── API routes ────────────────────────────────────────────────────────────────
# Registered on a router so they can be exposed under BOTH "" and "/api":
#   - dev:  the Vite proxy strips /api → hits the bare route
#   - prod: FastAPI serves the SPA + /api/* on the same origin
api = APIRouter()


@api.post("/analyze")
async def analyze(file: UploadFile = File(...), expertise: str = Form("")):
    raw = (await file.read()).decode("utf-8", errors="replace")
    thread_id = str(uuid.uuid4())
    run_config = {"configurable": {"thread_id": thread_id}}
    initial = {
        "raw_logs": raw,
        "filename": file.filename,
        "operator_expertise": _parse_expertise(expertise),
        "trace": [],
    }

    async def event_stream():
        # Accumulate from streamed updates so the done event does not depend on
        # checkpoint deserialization (get_state) after the run.
        final = dict(initial)
        async for chunk in graph.astream(initial, run_config, stream_mode="updates"):
            for node_name, update in chunk.items():
                if not isinstance(update, dict):
                    continue
                _merge_update(final, update)
                payload = {"node": node_name, "update": _jsonable(update)}
                yield {"event": "node", "data": json.dumps(payload)}
        yield {"event": "done", "data": json.dumps(_jsonable(final))}

    return EventSourceResponse(event_stream())


@api.get("/events/recent")
def events_recent(limit: int = 120):
    """Live telemetry buffer, populated by external systems via the webhook."""
    return {"events": live_store.recent(limit)}


@api.get("/metrics/traffic")
def metrics_traffic():
    """Per-minute traffic buckets derived from the live telemetry buffer."""
    return {"points": live_store.traffic_points()}


# Webhook ingestion (/webhook/ingest, /webhook/logs, …) lives under the same prefixes.
api.include_router(webhook.router)

app.include_router(api)              # bare paths (dev proxy target)
app.include_router(api, prefix="/api")  # same-origin API for production


# ── Static file serving (production only) ────────────────────────────────────
# Mount the built React app so that:
#   /assets/*  → hashed JS/CSS bundles
#   /           → index.html (and any deep route via the catch-all below)
# This is a no-op in local dev if STATIC_DIR doesn't exist yet.
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", response_class=HTMLResponse, include_in_schema=False)
    async def serve_spa(full_path: str) -> HTMLResponse:  # noqa: ARG001
        """Catch-all: return index.html so React Router handles client-side routes."""
        return HTMLResponse((STATIC_DIR / "index.html").read_text())
