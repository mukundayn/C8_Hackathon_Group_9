"""Webhook endpoints for external system integration.

Two ingest paths:
  POST /webhook/logs   — lightweight; pushes into the live cockpit buffer (no LLM)
  POST /webhook/ingest — full LangGraph analysis (strict or loose JSON body)

The UI "copy URL" points at /api/webhook/logs.
"""

from __future__ import annotations

import json
import uuid
import logging
import asyncio
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Body, Header, HTTPException, Request
from pydantic import ValidationError

from app.models import WebhookEvent, WebhookResponse
from app.graph import graph
from app import live_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["webhook"])

_API_KEYS: set[str] = set()
_webhook_results: dict[str, dict] = {}


def register_api_key(key: str) -> None:
    _API_KEYS.add(key)


def _validate_api_key(api_key: Optional[str]) -> bool:
    if not _API_KEYS:
        return True
    return api_key in _API_KEYS


def _extract_logs_from_payload(event: WebhookEvent) -> str:
    """Extract log text from various webhook payload formats."""
    payload = event.payload

    if "logs" in payload:
        logs = payload["logs"]
        if isinstance(logs, list):
            return "\n".join(str(line) for line in logs)
        return str(logs)

    if "message" in payload:
        return str(payload["message"])

    if "alert" in payload:
        alert = payload["alert"]
        parts = []
        if isinstance(alert, dict):
            parts.append(f"ALERT: {alert.get('name', 'unknown')}")
            parts.append(f"Status: {alert.get('status', 'unknown')}")
            parts.append(f"Severity: {alert.get('severity', 'unknown')}")
            if "description" in alert:
                parts.append(f"Description: {alert['description']}")
            if "metric" in alert:
                parts.append(f"Metric: {alert['metric']} = {alert.get('value', 'N/A')}")
            if "tags" in alert:
                parts.append(f"Tags: {', '.join(str(t) for t in alert['tags'])}")
            return "\n".join(parts)
        return str(alert)

    if "event" in payload:
        ev = payload["event"]
        if isinstance(ev, dict):
            return json.dumps(ev, indent=2)
        return str(ev)

    return json.dumps(payload, indent=2)


def _coerce_webhook_event(body: dict[str, Any]) -> WebhookEvent:
    """Accept either the strict WebhookEvent shape or a loose monitoring payload."""
    try:
        return WebhookEvent.model_validate(body)
    except ValidationError:
        pass

    # Loose shape: treat the whole body as the payload.
    source = str(body.get("source") or body.get("service") or "webhook")
    event_type = str(body.get("event_type") or "log_batch")
    if "payload" in body and isinstance(body["payload"], dict):
        payload = body["payload"]
    else:
        payload = body
    return WebhookEvent(
        source=source,
        event_type=event_type,
        payload=payload,
        timestamp=body.get("timestamp"),
        callback_url=body.get("callback_url"),
    )


def _live_feed_meta(**extra: Any) -> dict[str, Any]:
    """Honest contract for /webhook/logs — telemetry buffer only, no LangGraph."""
    return {
        "mode": "live_feed",
        "runs_llm": False,
        "full_analysis": "POST /api/webhook/ingest (LangGraph) or upload via cockpit /api/analyze",
        **extra,
    }


def _ingest_loose_body(payload: dict[str, Any], default_source: str = "n8n") -> dict[str, Any]:
    """Shared logic for /logs — push into live_store, no LLM."""
    source = str(payload.get("source", default_source))

    if "logs" in payload:
        logs = payload["logs"]
        text = "\n".join(str(x) for x in logs) if isinstance(logs, list) else str(logs)
        added = live_store.add_events_from_text(text, source=source)
        logger.info("[webhook/logs] ingested %d line(s) from source=%s", added, source)
        return _live_feed_meta(
            status="ok",
            ingested=added,
            buffer_size=len(live_store.recent()),
        )

    # n8n Parse often uses logEntry / fileName instead of message / service
    message = payload.get("message") or payload.get("logEntry") or payload.get("text")
    if message is not None and str(message).strip():
        ev = live_store.add_event(
            message=str(message),
            severity=str(payload.get("severity") or payload.get("level") or "INFO"),
            service=str(payload.get("service") or payload.get("fileName") or source),
            category=payload.get("category"),
            source=source,
            response_time_ms=payload.get("response_time_ms"),
            timestamp=payload.get("timestamp") if isinstance(payload.get("timestamp"), str) else None,
        )
        logger.info("[webhook/logs] ingested 1 event id=%s source=%s", ev["id"], source)
        return _live_feed_meta(
            status="ok",
            ingested=1,
            event_id=ev["id"],
            buffer_size=len(live_store.recent()),
        )

    ev = live_store.add_event(message=json.dumps(payload), source=source)
    logger.info("[webhook/logs] ingested raw JSON as 1 event id=%s", ev["id"])
    return _live_feed_meta(
        status="ok",
        ingested=1,
        event_id=ev["id"],
        buffer_size=len(live_store.recent()),
    )


async def _run_analysis(logs: str, request_id: str, source: str) -> dict:
    """Run the full analysis graph on extracted logs."""
    initial = {
        "raw_logs": logs,
        "filename": f"webhook-{source}-{request_id}",
        "trace": [],
    }
    config = {"configurable": {"thread_id": request_id}}

    final = dict(initial)
    async for chunk in graph.astream(initial, config, stream_mode="updates"):
        for _node_name, update in chunk.items():
            if isinstance(update, dict):
                for key, value in update.items():
                    if key == "trace":
                        final.setdefault("trace", []).extend(value or [])
                    else:
                        final[key] = value

    return final


async def _send_callback(callback_url: str, result: dict) -> None:
    """POST results back to the source system's callback URL."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(callback_url, json=result)
            logger.info(
                "Callback to %s: status=%d", callback_url, response.status_code
            )
    except Exception as e:
        logger.error("Callback to %s failed: %s", callback_url, e)


@router.post("/ingest", response_model=WebhookResponse)
async def ingest_webhook(
    request: Request,
    x_api_key: Optional[str] = Header(None),
    body: dict[str, Any] = Body(...),
):
    """Receive a webhook event and run full LangGraph analysis.

    Accepts the strict WebhookEvent schema OR a loose JSON body
    ({"message": "..."} / {"logs": [...]} / etc.).
    Always mirrors extracted lines into the live cockpit buffer first.
    """
    if not _validate_api_key(x_api_key):
        raise HTTPException(status_code=401, detail="Invalid API key")

    event = _coerce_webhook_event(body)
    request_id = str(uuid.uuid4())
    logs = _extract_logs_from_payload(event)
    logger.info(
        "[webhook/ingest] source=%s event_type=%s chars=%d client=%s",
        event.source,
        event.event_type,
        len(logs),
        request.client.host if request.client else "?",
    )

    # Surface on the live feed regardless of analysis success.
    if logs.strip():
        live_store.add_events_from_text(logs, source=event.source or "webhook")

    if not logs.strip():
        return WebhookResponse(
            request_id=request_id,
            status="error",
            message="No log data could be extracted from the payload.",
        )

    if event.callback_url:
        asyncio.create_task(_process_async(request_id, logs, event))
        return WebhookResponse(
            request_id=request_id,
            status="accepted",
            message=f"Analysis started. Results will be sent to {event.callback_url}",
        )

    try:
        result = await _run_analysis(logs, request_id, event.source)
        _webhook_results[request_id] = _sanitize_result(result)
        return WebhookResponse(
            request_id=request_id,
            status="completed",
            message=f"Analysis complete. {len(result.get('issues', []))} issue(s) detected.",
            results=_sanitize_result(result),
        )
    except Exception as e:
        logger.error("Webhook analysis failed: %s", e)
        return WebhookResponse(
            request_id=request_id,
            status="error",
            message=f"Analysis failed: {str(e)}",
        )


async def _process_async(request_id: str, logs: str, event: WebhookEvent):
    """Process webhook asynchronously and send callback."""
    try:
        result = await _run_analysis(logs, request_id, event.source)
        sanitized = _sanitize_result(result)
        _webhook_results[request_id] = sanitized
        if event.callback_url:
            await _send_callback(event.callback_url, {
                "request_id": request_id,
                "status": "completed",
                "results": sanitized,
            })
    except Exception as e:
        logger.error("Async analysis failed for %s: %s", request_id, e)
        if event.callback_url:
            await _send_callback(event.callback_url, {
                "request_id": request_id,
                "status": "error",
                "error": str(e),
            })


@router.get("/result/{request_id}")
async def get_result(request_id: str):
    """Poll for webhook analysis results by request ID."""
    if request_id in _webhook_results:
        return {
            "request_id": request_id,
            "status": "completed",
            "results": _webhook_results[request_id],
        }
    return {
        "request_id": request_id,
        "status": "pending",
        "message": "Analysis still in progress or request ID not found.",
    }


@router.post("/logs")
async def ingest_logs(
    payload: dict[str, Any] = Body(...),
):
    """Lightweight ingestion for n8n / monitoring — live buffer only (no LLM).

    Accepts:
      - {"logs": ["line", ...]} or {"logs": "multi\\nline"}
      - {"message": "...", "severity": "...", "service": "...", "category": "..."}
      - any other JSON → one stringified event
    """
    # Ignore legacy judge-harness keys if a client still sends them.
    payload.pop("pipeline_demo", None)
    payload.pop("demo_mode", None)

    result = _ingest_loose_body(payload, default_source="n8n")
    preview = payload.get("message") or payload.get("logs") or payload
    if not isinstance(preview, str):
        preview = json.dumps(preview)[:200]
    logger.info(
        "[webhook/logs] live_feed source=%s ingested=%s preview=%s",
        payload.get("source", "n8n"),
        result.get("ingested"),
        str(preview)[:200],
    )
    return result


@router.post("/test")
async def test_webhook():
    """Connectivity probe + inject a sample event into the live buffer."""
    sample = {
        "source": "webhook-test",
        "message": "NETRA webhook probe — CRITICAL database-service: connection pool exhausted",
        "severity": "CRITICAL",
        "service": "database-service",
        "category": "Database",
        "response_time_ms": 890,
    }
    result = _ingest_loose_body(sample, default_source="webhook-test")
    return {
        "status": "ok",
        "message": "Webhook endpoint is reachable. A sample CRITICAL event was pushed to the live buffer.",
        "ingest": result,
        "endpoints": {
            "live_feed": "POST /api/webhook/logs  (mode=live_feed, runs_llm=false)",
            "full_analysis": "POST /api/webhook/ingest  (LangGraph) or cockpit /api/analyze",
        },
        "example_logs_body": {
            "source": "n8n",
            "message": "ERROR auth-service: JWT verification flood",
            "severity": "ERROR",
            "service": "auth-service",
            "category": "Auth",
        },
        "mode": "live_feed",
        "runs_llm": False,
    }


def _sanitize_result(result: dict) -> dict:
    """Strip large/internal fields from results before returning."""
    safe = {}
    for key in ("issues", "remediations", "cookbook", "jira_tickets", "slack_result",
                 "image_analysis", "fallback_results"):
        if key in result:
            safe[key] = result[key]
    return safe
