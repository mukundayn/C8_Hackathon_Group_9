"""Webhook endpoints for external system integration.

Any live monitoring system (Datadog, PagerDuty, Grafana, CloudWatch, etc.)
can POST alerts/incidents to these endpoints and receive analysis results.

Supported event types:
- alert: a monitoring alert with metric data
- incident: a structured incident payload
- log_batch: raw log lines for analysis
"""

import json
import uuid
import logging
import asyncio
from typing import Optional

import httpx
from fastapi import APIRouter, Body, Header, HTTPException

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
async def ingest_webhook(event: WebhookEvent, x_api_key: Optional[str] = Header(None)):
    """Receive a webhook event and analyze it.

    Accepts payloads from monitoring systems in various formats.
    If a callback_url is provided, results are POSTed back asynchronously.
    """
    if not _validate_api_key(x_api_key):
        raise HTTPException(status_code=401, detail="Invalid API key")

    request_id = str(uuid.uuid4())
    logs = _extract_logs_from_payload(event)

    # Surface the incoming logs on the live cockpit feed regardless of analysis.
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
async def ingest_logs(payload: dict = Body(...)):
    """Lightweight ingestion endpoint for n8n / monitoring sources.

    Pushes events onto the live cockpit feed (no LLM analysis). Accepts:
      - {"logs": ["line", ...]} or {"logs": "multi\\nline"}  → one event per line
      - {"message": "...", "severity": "...", "service": "...", "category": "..."}
      - any other JSON                                        → single stringified event
    """
    source = str(payload.get("source", "n8n"))

    if "logs" in payload:
        logs = payload["logs"]
        text = "\n".join(str(x) for x in logs) if isinstance(logs, list) else str(logs)
        added = live_store.add_events_from_text(text, source=source)
        return {"status": "ok", "ingested": added}

    if "message" in payload:
        ev = live_store.add_event(
            message=str(payload["message"]),
            severity=str(payload.get("severity", "INFO")),
            service=str(payload.get("service", source)),
            category=payload.get("category"),
            source=source,
            response_time_ms=payload.get("response_time_ms"),
        )
        return {"status": "ok", "ingested": 1, "event_id": ev["id"]}

    ev = live_store.add_event(message=json.dumps(payload), source=source)
    return {"status": "ok", "ingested": 1, "event_id": ev["id"]}


@router.post("/test")
async def test_webhook():
    """Test endpoint to verify webhook connectivity."""
    return {
        "status": "ok",
        "message": "Webhook endpoint is reachable.",
        "supported_sources": ["datadog", "pagerduty", "grafana", "cloudwatch", "custom"],
        "payload_format": {
            "source": "string (e.g. 'datadog')",
            "event_type": "string ('alert' | 'incident' | 'log_batch')",
            "payload": {
                "logs": "list[string] or string — raw log lines",
                "alert": "dict — structured alert object",
                "message": "string — free-form text",
            },
            "callback_url": "string (optional) — URL for async result delivery",
        },
    }


def _sanitize_result(result: dict) -> dict:
    """Strip large/internal fields from results before returning."""
    safe = {}
    for key in ("issues", "remediations", "cookbook", "jira_tickets", "slack_result",
                 "image_analysis", "fallback_results"):
        if key in result:
            safe[key] = result[key]
    return safe
