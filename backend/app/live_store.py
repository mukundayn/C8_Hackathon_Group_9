"""In-memory live telemetry store.

Populated by external systems (n8n, Datadog, Grafana, PagerDuty, …) via the
webhook endpoints — and by /analyze uploads so the cockpit gauges stay live.
Feeds the live log console and traffic analytics.
This is intentionally process-local and ephemeral — no DB required for the demo.
"""

from __future__ import annotations

import re
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone

# Cockpit / live feed timestamps are India Standard Time (UTC+05:30).
_IST = timezone(timedelta(hours=5, minutes=30))
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

# Numeric severity for chart Y-axis (INFO→CRITICAL).
SEVERITY_SCORE: dict[str, int] = {
    "INFO": 1,
    "WARN": 2,
    "ERROR": 3,
    "CRITICAL": 4,
}


def expertise_for_category(category: Optional[str]) -> str:
    if not category:
        return "General"
    return EXPERTISE_MAP.get(category.lower(), "General")


# ── Ring buffer ───────────────────────────────────────────────────────────────

_MAX_EVENTS = 200
_events: Deque[dict[str, Any]] = deque(maxlen=_MAX_EVENTS)
_lock = Lock()
_ingest_total = 0  # lifetime +1 per successfully added log (not capped by ring)
# Rolling analyze / ingest latencies for the Avg Response tile (not capped by event ring).
_latency_samples: Deque[int] = deque(maxlen=100)

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
    """Append one log event. Counts +1 toward ingest rate.

    When ``response_time_ms`` is omitted, records wall time spent building/storing
    the event so Avg Response can average real process latency.
    """
    global _ingest_total
    t0 = time.perf_counter()
    sev = _normalize_severity(severity)
    cat = category or _guess_category(message, service)
    process_ms = max(1, int(round((time.perf_counter() - t0) * 1000)))
    event = {
        "id": uuid.uuid4().hex,
        "timestamp": timestamp or datetime.now(_IST).strftime("%H:%M:%S"),
        "service": service,
        "severity": sev,
        "message": message.strip(),
        "category": cat,
        "source": source,
        "response_time_ms": int(response_time_ms) if response_time_ms is not None else process_ms,
        "severity_score": SEVERITY_SCORE.get(sev, 1),
    }
    with _lock:
        _events.append(event)
        _ingest_total += 1
        _latency_samples.append(int(event["response_time_ms"]))
    return event


def record_analyze_ms(duration_ms: int) -> None:
    """Record one full /analyze pipeline duration for the Avg Response rollup."""
    ms = max(1, int(duration_ms))
    with _lock:
        _latency_samples.append(ms)


def avg_response_ms() -> int:
    """Mean of recent ingest + analyze latency samples (session rollup)."""
    with _lock:
        if not _latency_samples:
            return 0
        return round(sum(_latency_samples) / len(_latency_samples))


def add_events_from_text(text: str, source: str = "webhook") -> int:
    """Parse a raw log blob into individual live events (one per line).

    Each line bumps ingest rate by +1. Batch wall time is split across lines
    (minimum 1ms each) so Avg Response reflects process cost of the add.
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return 0

    t0 = time.perf_counter()
    # Pre-parse so timing covers the full add work.
    parsed: list[tuple[str, str, str]] = []
    for line in lines:
        sev_match = _SEVERITY_RE.search(line)
        severity = sev_match.group(1) if sev_match else "INFO"
        svc_match = _SERVICE_RE.search(line)
        service = svc_match.group(1) if svc_match else source
        parsed.append((line, severity, service))

    elapsed_ms = max(1, int(round((time.perf_counter() - t0) * 1000)))
    # Share batch cost across lines; each gets at least 1ms so the avg tile moves.
    per_line = max(1, elapsed_ms // len(parsed))

    count = 0
    for line, severity, service in parsed:
        add_event(
            message=line,
            severity=severity,
            service=service,
            source=source,
            response_time_ms=per_line,
        )
        count += 1
    return count


def recent(limit: int = _MAX_EVENTS) -> list[dict[str, Any]]:
    """Return newest-first events (UI prepends fresh rows at the top)."""
    with _lock:
        items = list(_events)
    # deque is oldest→newest; reverse so clients see latest first.
    return list(reversed(items[-limit:]))


def ingest_total() -> int:
    """Lifetime count of added logs (not limited by ring buffer size)."""
    with _lock:
        return _ingest_total


def critical_count() -> int:
    """Rollup of CRITICAL severity events currently in the buffer."""
    with _lock:
        return sum(1 for ev in _events if ev.get("severity") == "CRITICAL")


def clear() -> None:
    global _ingest_total
    with _lock:
        _events.clear()
        _ingest_total = 0
        _latency_samples.clear()


def traffic_points(max_buckets: int = 24) -> list[dict[str, Any]]:
    """Aggregate the buffer into per-second buckets for volume/sec + severity.

    Each bucket:
      - requests / volume_per_sec: event count in that second
      - errors: ERROR + CRITICAL count
      - avg_response_ms: mean process/response latency
      - avg_severity: mean severity score (1=INFO … 4=CRITICAL)
    """
    with _lock:
        items = list(_events)

    buckets: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for ev in items:
        ts = str(ev.get("timestamp", ""))
        # Prefer HH:MM:SS (volume/sec); fall back to HH:MM for older callers.
        key = ts[:8] if len(ts) >= 8 else ts[:5]
        if key not in buckets:
            buckets[key] = {
                "time": key,
                "requests": 0,
                "errors": 0,
                "_rt": 0,
                "_rtn": 0,
                "_sev": 0,
            }
            order.append(key)
        b = buckets[key]
        b["requests"] += 1
        if ev.get("severity") in ("ERROR", "CRITICAL"):
            b["errors"] += 1
        rt = ev.get("response_time_ms") or 0
        if rt:
            b["_rt"] += rt
            b["_rtn"] += 1
        b["_sev"] += int(ev.get("severity_score") or SEVERITY_SCORE.get(ev.get("severity", "INFO"), 1))

    points = []
    for key in order[-max_buckets:]:
        b = buckets[key]
        n = b["requests"] or 1
        avg = round(b["_rt"] / b["_rtn"]) if b["_rtn"] else 0
        # One-second buckets → volume/sec == request count in that second.
        points.append(
            {
                "time": b["time"],
                "requests": b["requests"],
                "volume_per_sec": b["requests"],
                "errors": b["errors"],
                "avg_response_ms": avg,
                "avg_severity": round(b["_sev"] / n, 2),
            }
        )
    return points
