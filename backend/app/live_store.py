"""In-memory live telemetry store.

Populated by external systems (n8n, Datadog, Grafana, PagerDuty, …) via the
webhook endpoints. Feeds the cockpit's live log console and traffic analytics.
This is intentionally process-local and ephemeral — no DB required for the demo.
"""

from __future__ import annotations

import re
import uuid
from collections import deque
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Deque, Optional

# ── Category / expertise routing (mirrors the frontend heuristic) ─────────────

# Maps the classifier's IssueCategory → an operator expertise domain.
EXPERTISE_MAP: dict[str, str] = {
    "database": "DB",
    "deadlock": "DB",
    "cache": "DB",
    "network": "Network",
    "dns": "Network",
    "load_balancer": "Network",
    "timeout": "Network",
    "rate_limit": "Network",
    "certificate": "Network",
    "auth": "Network",
    "security": "Network",
    "memory_leak": "Memory",
    "cpu_saturation": "CPU",
    "container_crash": "CPU",
}


def expertise_for_category(category: Optional[str]) -> str:
    if not category:
        return "General"
    return EXPERTISE_MAP.get(category.lower(), "General")


# ── Ring buffer ───────────────────────────────────────────────────────────────

_MAX_EVENTS = 200
_events: Deque[dict[str, Any]] = deque(maxlen=_MAX_EVENTS)
_lock = Lock()

_SEVERITY_RE = re.compile(
    r"\b(CRITICAL|FATAL|PANIC|ERROR|ERR|FAIL|WARN|WARNING|INFO|DEBUG)\b",
    re.IGNORECASE,
)
_SERVICE_RE = re.compile(r"\]?\s*([a-z0-9][a-z0-9._-]{2,40})[:]\s", re.IGNORECASE)


def _normalize_severity(raw: str) -> str:
    s = (raw or "").upper()
    if any(k in s for k in ("CRIT", "FATAL", "PANIC")):
        return "CRITICAL"
    if "ERR" in s or "FAIL" in s:
        return "ERROR"
    if "WARN" in s:
        return "WARN"
    return "INFO"


def _guess_category(message: str, service: str) -> str:
    text = f"{message} {service}".lower()
    if any(k in text for k in ("postgres", "database", "sql", "connection pool", "deadlock")):
        return "Database"
    if any(k in text for k in ("auth", "jwt", "token", "login", "oauth")):
        return "Auth"
    if any(k in text for k in ("waf", "firewall", "dns", "network", "timeout", "ddos", "subnet")):
        return "Network"
    if any(k in text for k in ("oom", "memory", "heap", "kubelet", "pod", "container")):
        return "System"
    return "API"


def add_event(
    *,
    message: str,
    severity: str = "INFO",
    service: str = "external",
    category: Optional[str] = None,
    source: str = "webhook",
    response_time_ms: Optional[int] = None,
    timestamp: Optional[str] = None,
) -> dict[str, Any]:
    sev = _normalize_severity(severity)
    cat = category or _guess_category(message, service)
    event = {
        "id": uuid.uuid4().hex,
        "timestamp": timestamp or datetime.now(timezone.utc).strftime("%H:%M:%S"),
        "service": service,
        "severity": sev,
        "message": message.strip(),
        "category": cat,
        "source": source,
        "response_time_ms": response_time_ms if response_time_ms is not None else 0,
    }
    with _lock:
        _events.append(event)
    return event


def add_events_from_text(text: str, source: str = "webhook") -> int:
    """Parse a raw log blob into individual live events (one per line)."""
    count = 0
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        sev_match = _SEVERITY_RE.search(line)
        severity = sev_match.group(1) if sev_match else "INFO"
        svc_match = _SERVICE_RE.search(line)
        service = svc_match.group(1) if svc_match else source
        add_event(message=line, severity=severity, service=service, source=source)
        count += 1
    return count


def recent(limit: int = _MAX_EVENTS) -> list[dict[str, Any]]:
    with _lock:
        items = list(_events)
    return items[-limit:]


def clear() -> None:
    with _lock:
        _events.clear()


def traffic_points(max_buckets: int = 12) -> list[dict[str, Any]]:
    """Aggregate the buffer into per-minute buckets for the traffic chart."""
    with _lock:
        items = list(_events)

    buckets: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for ev in items:
        key = str(ev.get("timestamp", ""))[:5]  # HH:MM
        if key not in buckets:
            buckets[key] = {"time": key, "requests": 0, "errors": 0, "_rt": 0, "_rtn": 0}
            order.append(key)
        b = buckets[key]
        b["requests"] += 1
        if ev.get("severity") in ("ERROR", "CRITICAL"):
            b["errors"] += 1
        rt = ev.get("response_time_ms") or 0
        if rt:
            b["_rt"] += rt
            b["_rtn"] += 1

    points = []
    for key in order[-max_buckets:]:
        b = buckets[key]
        avg = round(b["_rt"] / b["_rtn"]) if b["_rtn"] else 0
        points.append(
            {
                "time": b["time"],
                "requests": b["requests"],
                "errors": b["errors"],
                "avg_response_ms": avg,
            }
        )
    return points
