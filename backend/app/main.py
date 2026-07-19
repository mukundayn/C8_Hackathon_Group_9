import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from app.graph import graph
from app.knowledge.runbook_store import seed_if_empty
from app.debug_log import MAIN_SOURCE, describe_node_update, debug_line
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

# CORS: default "*" so Render same-origin + local Vite both work.
# Override with CORS_ORIGINS=https://a.com,https://b.com for lockdown.
_cors_origins_raw = os.getenv("CORS_ORIGINS", "*")
if _cors_origins_raw.strip() == "*":
    _cors_origins = ["*"]
else:
    _cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=_cors_origins != ["*"],
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
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    # Keep SSE payloads JSON-safe even if a node sneaks in a non-serializable value.
    return str(obj)


def _merge_update(final: dict, update: dict) -> None:
    """Fold a streamed node update into the accumulated final state."""
    for key, value in update.items():
        if key == "trace":
            final.setdefault("trace", []).extend(value or [])
        else:
            final[key] = value


def _parse_expertise(raw: str) -> list[str]:
    return [e.strip() for e in (raw or "").split(",") if e.strip()]


def _done_payload(final: dict) -> dict:
    """Build a JSON-safe `done` payload; drop bulky raw inputs from the wire."""
    slim = {k: v for k, v in final.items() if k not in ("raw_logs",)}
    try:
        return _jsonable(slim)
    except Exception:
        return {
            "issues": _jsonable(final.get("issues") or []),
            "remediations": _jsonable(final.get("remediations") or []),
            "cookbook": _jsonable(final.get("cookbook") or {}),
            "jira_tickets": _jsonable(final.get("jira_tickets") or []),
            "slack_result": _jsonable(final.get("slack_result") or {}),
            "trace": _jsonable(final.get("trace") or []),
            "fallback_results": _jsonable(final.get("fallback_results")),
        }


# ── API routes ────────────────────────────────────────────────────────────────
# Registered on a router so they can be exposed under BOTH "" and "/api":
#   - dev:  the Vite proxy strips /api → hits the bare route
#   - prod: FastAPI serves the SPA + /api/* on the same origin
api = APIRouter()


@api.get("/ping")
def ping():
    """Cheap connectivity check for the UI / Render smoke tests."""
    return {"ok": True, "service": "netra-api"}


@api.post("/analyze")
async def analyze(request: Request):
    """Stream LangGraph analysis over SSE.

    Prefer JSON body (avoids Render/WAF 403 on multipart uploads)::

        {"log_text": "...", "filename": "app.log", "expertise": "DB,Memory"}

    Multipart ``file`` + ``expertise`` is still accepted for local tooling.
    """
    content_type = (request.headers.get("content-type") or "").lower()
    filename = "upload.log"
    expertise_raw = ""
    raw = ""

    if "application/json" in content_type:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="JSON body must be an object")
        raw = str(body.get("log_text") or body.get("logs") or body.get("text") or "")
        filename = str(body.get("filename") or filename)
        expertise_raw = str(body.get("expertise") or "")
    elif "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        expertise_raw = str(form.get("expertise") or "")
        if upload is None:
            raise HTTPException(status_code=400, detail="Missing form field 'file'")
        data = await upload.read()  # type: ignore[union-attr]
        raw = data.decode("utf-8", errors="replace") if isinstance(data, (bytes, bytearray)) else str(data)
        filename = getattr(upload, "filename", None) or filename
    else:
        # Fallback: raw text body
        raw = (await request.body()).decode("utf-8", errors="replace")

    if not raw.strip():
        raise HTTPException(status_code=400, detail="No log text provided")

    print(
        f"[analyze] POST from {request.client.host if request.client else '?'} "
        f"filename={filename!r} chars={len(raw)} ct={content_type[:40]!r}"
    )

    thread_id = str(uuid.uuid4())
    run_config = {"configurable": {"thread_id": thread_id}}
    initial = {
        "raw_logs": raw,
        "filename": filename,
        "operator_expertise": _parse_expertise(expertise_raw),
        "trace": [],
    }

    async def event_stream():
        # Accumulate from streamed updates so the done event does not depend on
        # checkpoint deserialization (get_state) after the run.
        # Always emit `error` and/or `done` so the UI never hangs on a dropped generator.
        final = dict(initial)
        try:
            yield {
                "event": "status",
                "data": json.dumps({"phase": "started", "filename": filename, "chars": len(raw)}),
            }
            # TEMP debug strip on UI — remove after testing.
            yield {
                "event": "debug",
                "data": json.dumps(
                    debug_line(
                        file=MAIN_SOURCE,
                        message=f"analyze start · file={filename!r} chars={len(raw)} · graph.astream",
                    )
                ),
            }
            print(f"[analyze] start filename={filename!r} chars={len(raw)}", flush=True)
            async for chunk in graph.astream(initial, run_config, stream_mode="updates"):
                for node_name, update in chunk.items():
                    if not isinstance(update, dict):
                        continue
                    _merge_update(final, update)
                    payload = {"node": node_name, "update": _jsonable(update)}
                    yield {"event": "node", "data": json.dumps(payload)}
                    for dbg in describe_node_update(node_name, update):
                        print(f"[analyze:debug] {dbg['file']} · {dbg['message']}", flush=True)
                        yield {"event": "debug", "data": json.dumps(dbg)}
                    print(f"[analyze] node={node_name} ok", flush=True)
            yield {
                "event": "debug",
                "data": json.dumps(
                    debug_line(
                        file=MAIN_SOURCE,
                        message="analyze done · emitting final state",
                    )
                ),
            }
            yield {"event": "done", "data": json.dumps(_done_payload(final))}
            print("[analyze] done emitted", flush=True)
        except Exception as exc:
            # LLM/RAG failures, serialization bugs, etc. — surface to the client.
            msg = f"{type(exc).__name__}: {exc}"
            print(f"[analyze] stream failed: {msg}", flush=True)
            yield {
                "event": "debug",
                "data": json.dumps(
                    debug_line(file=MAIN_SOURCE, message=f"ANALYZE FAILED · {msg}", level="ERROR")
                ),
            }
            yield {"event": "error", "data": json.dumps({"message": msg})}
            try:
                partial = _done_payload(final)
                partial["error"] = msg
                yield {"event": "done", "data": json.dumps(partial)}
            except Exception as done_exc:
                yield {
                    "event": "done",
                    "data": json.dumps(
                        {
                            "issues": [],
                            "trace": final.get("trace") or [],
                            "error": f"{msg} (and done serialize failed: {done_exc})",
                        }
                    ),
                }

    # ping keeps Render/proxies from treating a quiet LLM wait as a dead connection
    return EventSourceResponse(event_stream(), ping=15)


@api.get("/events/recent")
def events_recent(limit: int = 120):
    """Live telemetry buffer, populated by external systems via the webhook."""
    return {"events": live_store.recent(limit)}


@api.get("/metrics/traffic")
def metrics_traffic():
    """Per-minute traffic buckets derived from the live telemetry buffer."""
    return {"points": live_store.traffic_points()}


@api.get("/debug/pipeline-demo")
def pipeline_demo_help():
    """Evaluator cheat-sheet for the 4-level RAG + LangGraph terminal demo."""
    return {
        "title": "Netra pipeline evaluation demo",
        "what_you_will_see": [
            "WEBHOOK banner (path A) or DEBUG banner (path B)",
            "LEVEL 1/4 memory → RAG hits → LangGraph nodes",
            "LEVEL 2/4 database → RAG hits → LangGraph nodes",
            "LEVEL 3/4 network → RAG hits → LangGraph nodes",
            "LEVEL 4/4 critical → RAG hits → LangGraph nodes",
            "DONE summary with PASS/FAIL per level",
        ],
        "path_A_webhook": {
            "quick": "POST /api/webhook/logs/demo",
            "flag_on_logs": {
                "url": "POST /api/webhook/logs",
                "body": {
                    "source": "n8n",
                    "message": "ERROR db: pool exhausted",
                    "pipeline_demo": True,
                    "demo_mode": "full",
                },
            },
        },
        "path_B_debug": {
            "url": "POST /api/debug/pipeline-demo?mode=full",
            "modes": {
                "full": "RAG + full LangGraph per level (best for judges)",
                "rag_only": "RAG only — faster smoke test without LLM",
            },
        },
        "hint": "Run uvicorn in a visible terminal. All evidence prints there, not in the browser.",
    }


@api.post("/debug/pipeline-demo")
async def pipeline_demo_run(request: Request):
    """Path B: run the 4-level evaluation demo and print evidence to the server terminal.

    Query: ``?mode=full`` (default) or ``?mode=rag_only``.
    """
    from app.pipeline_demo import run_pipeline_demo

    mode = request.query_params.get("mode") or "full"
    if mode not in ("full", "rag_only"):
        mode = "full"
    print("\n" + "#" * 72, flush=True)
    print("  DEBUG ROUTE · POST /api/debug/pipeline-demo", flush=True)
    print("#" * 72, flush=True)
    return await run_pipeline_demo(trigger="debug:/api/debug/pipeline-demo", mode=mode)  # type: ignore[arg-type]


# Webhook ingestion (/webhook/ingest, /webhook/logs, …) lives under the same prefixes.
api.include_router(webhook.router)

app.include_router(api)              # bare paths (dev proxy target)
app.include_router(api, prefix="/api")  # same-origin API for production


# ── Static file serving (production only) ────────────────────────────────────
# Mount the built React app so that:
#   /assets/*  → hashed JS/CSS bundles
#   /           → index.html (and any deep route via the catch-all below)
# This is a no-op in local dev if STATIC_DIR doesn't exist yet.
def _is_reserved_spa_path(full_path: str) -> bool:
    first = full_path.lstrip("/").split("/", 1)[0]
    return first in {
        "api",
        "health",
        "docs",
        "redoc",
        "openapi.json",
        "webhook",
        "debug",
        "assets",
    }


if STATIC_DIR.is_dir():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", response_class=HTMLResponse, include_in_schema=False)
    async def serve_spa(full_path: str) -> HTMLResponse:
        """Catch-all for client routes — never shadows API paths."""
        if _is_reserved_spa_path(full_path):
            raise HTTPException(status_code=404, detail="Not found")
        index = STATIC_DIR / "index.html"
        if not index.is_file():
            raise HTTPException(status_code=404, detail="Frontend not built")
        return HTMLResponse(index.read_text(encoding="utf-8"))
else:
    @app.get("/")
    def root():
        return JSONResponse({
            "service": "netra-api",
            "hint": "STATIC_DIR not set — API only. Use Vite dev server for UI.",
        })
