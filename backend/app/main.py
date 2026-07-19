import base64
import json
import mimetypes
import os
import time
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
from app.openrouter_key import reset_request_openrouter_key, set_request_openrouter_key

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


_BULKY_STATE_KEYS = frozenset(
    {"raw_logs", "image_data", "image_mime", "image_description"}
)


def _done_payload(final: dict) -> dict:
    """Build a JSON-safe `done` payload; drop bulky raw inputs from the wire.

    Critical: never echo ``image_data`` (base64) in SSE — it OOMs/proxy-kills
    the stream on Render free tier and freezes the browser.
    """
    slim = {k: v for k, v in final.items() if k not in _BULKY_STATE_KEYS}
    # Keep a tiny flag so the UI knows vision ran without shipping pixels.
    if final.get("image_data") or final.get("image_analysis"):
        slim["had_image"] = True
    try:
        return _jsonable(slim)
    except Exception:
        return {
            "issues": _jsonable(final.get("issues") or []),
            "remediations": _jsonable(final.get("remediations") or []),
            "cookbook": _jsonable(final.get("cookbook") or {}),
            "jira_tickets": _jsonable(final.get("jira_tickets") or []),
            "slack_result": _jsonable(final.get("slack_result") or {}),
            "hitl_pending": _jsonable(final.get("hitl_pending") or []),
            "trace": _jsonable(final.get("trace") or []),
            "fallback_results": _jsonable(final.get("fallback_results")),
            "image_analysis": _jsonable(final.get("image_analysis")),
            "had_image": bool(final.get("image_data") or final.get("image_analysis")),
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

        {
          "log_text": "...",
          "filename": "app.log",
          "expertise": "DB,Memory",
          "openrouter_api_key": "sk-or-...",
          "image_data": "<optional base64>",
          "image_mime": "image/png",
          "image_description": "optional caption"
        }

    Multipart ``file`` + ``expertise`` is still accepted for local tooling.
    Operators must supply their own OpenRouter key (body or ``X-OpenRouter-Api-Key``)
    so host credits are not shared across logins.
    """
    content_type = (request.headers.get("content-type") or "").lower()
    filename = "upload.log"
    expertise_raw = ""
    raw = ""
    image_data = ""
    image_mime = ""
    image_description = ""
    openrouter_key = (request.headers.get("x-openrouter-api-key") or "").strip()

    if "application/json" in content_type:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="JSON body must be an object")
        raw = str(body.get("log_text") or body.get("logs") or body.get("text") or "")
        filename = str(body.get("filename") or filename)
        expertise_raw = str(body.get("expertise") or "")
        image_data = str(body.get("image_data") or "").strip()
        image_mime = str(body.get("image_mime") or "").strip()
        image_description = str(body.get("image_description") or "").strip()
        # Allow data-URL payloads from clients
        if image_data.startswith("data:") and "," in image_data:
            header, image_data = image_data.split(",", 1)
            if ";base64" in header and header.startswith("data:"):
                image_mime = image_mime or header[5:].split(";", 1)[0]
        body_key = str(body.get("openrouter_api_key") or body.get("api_key") or "").strip()
        if body_key:
            openrouter_key = body_key
    elif "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        expertise_raw = str(form.get("expertise") or "")
        form_key = str(form.get("openrouter_api_key") or form.get("api_key") or "").strip()
        if form_key:
            openrouter_key = form_key
        if upload is None:
            raise HTTPException(status_code=400, detail="Missing form field 'file'")
        data = await upload.read()  # type: ignore[union-attr]
        filename = getattr(upload, "filename", None) or filename
        ctype = str(getattr(upload, "content_type", "") or "")
        is_image = ctype.startswith("image/") or str(filename).lower().endswith(
            (".png", ".jpg", ".jpeg", ".gif", ".webp")
        )
        if is_image and isinstance(data, (bytes, bytearray)):
            image_data = base64.b64encode(bytes(data)).decode("ascii")
            image_mime = ctype if ctype.startswith("image/") else (
                mimetypes.guess_type(str(filename))[0] or "image/png"
            )
            image_description = f"Operations screenshot upload: {filename}"
            raw = (
                f"[image-upload] {filename}\n"
                "INFO netra: screenshot attached for vision analysis\n"
            )
        else:
            raw = data.decode("utf-8", errors="replace") if isinstance(data, (bytes, bytearray)) else str(data)
    else:
        # Fallback: raw text body
        raw = (await request.body()).decode("utf-8", errors="replace")

    if not image_mime and image_data:
        image_mime = mimetypes.guess_type(filename)[0] or "image/png"

    if not raw.strip() and not image_data:
        raise HTTPException(status_code=400, detail="No log text or image provided")
    if not raw.strip() and image_data:
        raw = (
            f"[image-upload] {filename}\n"
            "INFO netra: screenshot attached for vision analysis\n"
        )

    if not openrouter_key:
        raise HTTPException(
            status_code=401,
            detail=(
                "OpenRouter API key required. Paste your key on the Netra login screen "
                "so analysis bills your account (not the shared host key)."
            ),
        )

    # Feed cockpit gauges: +1 ingest per line, process latency → Avg Response,
    # CRITICAL lines → Threat Incidents, traffic volume/sec + severity.
    try:
        live_store.add_events_from_text(raw, source=f"analyze:{filename}")
    except Exception as exc:  # noqa: BLE001 — never block analysis on telemetry
        print(f"[analyze] live_store feed skipped: {exc}", flush=True)

    print(
        f"[analyze] POST from {request.client.host if request.client else '?'} "
        f"filename={filename!r} chars={len(raw)} "
        f"image_b64={len(image_data) if image_data else 0} "
        f"ct={content_type[:40]!r} byok=1",
        flush=True,
    )

    thread_id = str(uuid.uuid4())
    run_config = {
        "configurable": {
            "thread_id": thread_id,
            "openrouter_api_key": openrouter_key,
        }
    }
    initial = {
        "raw_logs": raw,
        "filename": filename,
        "operator_expertise": _parse_expertise(expertise_raw),
        "trace": [],
    }
    if image_data:
        initial["image_data"] = image_data
        initial["image_mime"] = image_mime or "image/png"
        if image_description:
            initial["image_description"] = image_description

    async def event_stream():
        # Accumulate from streamed updates so the done event does not depend on
        # checkpoint deserialization (get_state) after the run.
        # Always emit `error` and/or `done` so the UI never hangs on a dropped generator.
        final = dict(initial)
        t0 = time.perf_counter()
        key_token = set_request_openrouter_key(openrouter_key)
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
                        message=f"analyze start · file={filename!r} chars={len(raw)} · graph.astream · BYOK",
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
                    # Hint next stage — remediation can take minutes (no debug until it finishes).
                    if node_name == "classifier":
                        n_issues = len(final.get("issues") or [])
                        yield {
                            "event": "debug",
                            "data": json.dumps(
                                debug_line(
                                    file="backend/app/nodes/remediation.py",
                                    node="remediation",
                                    message=(
                                        f"ENTERING remediation (blocking) · top {min(n_issues, 2)}/{n_issues} issue(s) → "
                                        "hybrid RAG + confidence rewrite (if low score) + 1 structured LLM (≤90s). "
                                        "Watch server prints [remediation] RAG k/n …"
                                    ),
                                )
                            ),
                        }
            elapsed_ms = int(round((time.perf_counter() - t0) * 1000))
            try:
                live_store.record_analyze_ms(elapsed_ms)
            except Exception as exc:  # noqa: BLE001
                print(f"[analyze] latency sample skipped: {exc}", flush=True)
            yield {
                "event": "debug",
                "data": json.dumps(
                    debug_line(
                        file=MAIN_SOURCE,
                        message=f"analyze done · {elapsed_ms}ms · emitting final state",
                    )
                ),
            }
            yield {"event": "done", "data": json.dumps(_done_payload(final))}
            print(f"[analyze] done emitted elapsed_ms={elapsed_ms}", flush=True)
        except Exception as exc:
            # LLM/RAG failures, serialization bugs, etc. — surface to the client.
            elapsed_ms = int(round((time.perf_counter() - t0) * 1000))
            try:
                live_store.record_analyze_ms(elapsed_ms)
            except Exception:
                pass
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
        finally:
            reset_request_openrouter_key(key_token)

    # ping keeps Render/proxies from treating a quiet LLM wait as a dead connection
    return EventSourceResponse(event_stream(), ping=15)


@api.get("/events/recent")
def events_recent(limit: int = 120):
    """Live telemetry buffer, populated by external systems via the webhook."""
    return {"events": live_store.recent(limit)}


@api.get("/metrics/traffic")
def metrics_traffic():
    """Per-second traffic buckets: volume/sec, errors, avg response, severity."""
    return {"points": live_store.traffic_points()}


@api.get("/metrics/hud")
def metrics_hud():
    """Cockpit gauge rollups driven by every ingested log line + analyze runs."""
    return {
        "ingest_total": live_store.ingest_total(),
        "avg_response_ms": live_store.avg_response_ms(),
        "critical_incidents": live_store.critical_count(),
    }


@api.get("/integrations/status")
def integrations_status():
    """Whether Jira/Slack will hit real APIs or stay mock (no secrets leaked)."""
    from app.config import config

    return {
        "jira": "real" if config.use_real_jira else "mock",
        "slack": "real" if config.use_real_slack else "mock",
        "jira_project": config.JIRA_PROJECT_KEY,
        "slack_channel": config.SLACK_CHANNEL,
    }


@api.post("/hitl/approve")
async def hitl_approve(request: Request):
    """Operator approved a newly-learned critical → create Jira + Slack.

    Body::
        {
          "issue_ids": ["id1"],
          "issues": [...],           # optional full issue dicts
          "remediations": [...],
          "operator_expertise": ["DB"],
          "cookbook": {...}
        }
    """
    from app.nodes.jira import create_tickets_for_issues, pending_hitl_issues
    from app.nodes.notifier import post_slack_for_issues

    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON body must be an object")

    issue_ids = {str(i) for i in (body.get("issue_ids") or []) if i}
    all_issues = list(body.get("issues") or [])
    remediations = list(body.get("remediations") or [])
    expertise = body.get("operator_expertise") or []
    if isinstance(expertise, str):
        expertise = _parse_expertise(expertise)
    cookbook = body.get("cookbook")

    # Prefer explicit pending payloads; else filter issues by id.
    pending = list(body.get("pending") or [])
    if not pending:
        fb_learned = list(body.get("learned_issue_ids") or [])
        pending = pending_hitl_issues(all_issues, remediations, fb_learned)

    if issue_ids:
        pending = [p for p in pending if str(p.get("issue_id") or p.get("id")) in issue_ids]
        # Also allow raw issues matched by id
        if not pending and all_issues:
            pending = [i for i in all_issues if str(i.get("id") or i.get("issue_id")) in issue_ids]

    if not pending:
        raise HTTPException(status_code=400, detail="No matching issues to approve")

    tickets = create_tickets_for_issues(pending, remediations, list(expertise))
    slack = post_slack_for_issues(pending, tickets, cookbook if isinstance(cookbook, dict) else None)

    print(
        f"[hitl/approve] approved={len(pending)} tickets={len(tickets)} "
        f"slack={slack.get('channel')}",
        flush=True,
    )
    return {
        "status": "approved",
        "approved_issue_ids": [p.get("issue_id") or p.get("id") for p in pending],
        "jira_tickets": tickets,
        "slack_result": slack,
    }


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
