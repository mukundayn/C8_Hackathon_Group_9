import os
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

from app.state import IncidentState
from app.models import ClassifierOutput
from app.parsing import parse_logs, cluster_errors
from app.llm import get_llm
from app.nodes._trace import trace_event

CLASSIFY_PROMPT = """You are a senior SRE triaging a production incident from log clusters.

You are given error/warning clusters extracted from uploaded logs. Each cluster has a signature,
an occurrence count, the affected service, and sample lines.

For each DISTINCT underlying problem, produce a DetectedIssue with:
- a short slug id (e.g. 'oom-order-service')
- a clear title
- the best-fitting category from: memory_leak, deployment_regression, database, network,
  cpu_saturation, timeout, auth, config, dns, certificate, disk, cache, messaging, search,
  rate_limit, container_crash, container_image, security, monitoring, load_balancer, deadlock, unknown
- a severity (critical/high/medium/low/info) reasoning about blast radius and user impact
- severity_detail: a detailed classification with:
  - level: same as severity
  - confidence: 0.0-1.0 how confident you are
  - blast_radius: 'single-service', 'multi-service', 'cluster-wide', or 'customer-facing'
  - user_impact: 'none', 'degraded', 'partial-outage', or 'full-outage'
  - escalation_needed: true if immediate senior on-call escalation is warranted
  - reasoning: 1-sentence justification for the severity level
- the affected service
- a 1-2 sentence plain-English summary
- evidence: the specific sample lines that justify the issue

SEVERITY CLASSIFICATION GUIDELINES:
- critical: customer-facing full outage, data loss risk, security breach. Always escalate.
- high: significant degradation, multi-service impact, approaching threshold. Usually escalate.
- medium: single-service degradation, performance issues, no data loss. Monitor closely.
- low: minor issues, cosmetic errors, non-production impact. Fix in next sprint.
- info: informational, no action needed. Log for trending.

Merge clusters that are symptoms of the same root cause into ONE issue.

CLUSTERS:
{clusters}
"""

_LLM_TIMEOUT_S = int(os.getenv("CLASSIFIER_LLM_TIMEOUT", "90"))

_LEVEL_TO_SEV = {
    "CRITICAL": "critical",
    "FATAL": "critical",
    "PANIC": "critical",
    "ERROR": "high",
    "ERR": "high",
    "WARN": "medium",
    "WARNING": "medium",
}


def _guess_category(text: str) -> str:
    t = text.lower()
    if any(k in t for k in ("postgres", "database", "sql", "connection pool", "pool exhaust", "deadlock")):
        return "database"
    if any(k in t for k in ("oom", "memory", "heap", "leak")):
        return "memory_leak"
    if any(k in t for k in ("auth", "jwt", "token", "login", "oauth")):
        return "auth"
    if any(k in t for k in ("dns", "timeout", "network", "tcp", "connection refused")):
        return "network"
    if any(k in t for k in ("cpu", "load average", "throttle")):
        return "cpu_saturation"
    if any(k in t for k in ("pod", "container", "oomkilled", "crashloop")):
        return "container_crash"
    return "unknown"


def _issues_from_clusters(clusters) -> list[dict]:
    """Deterministic fallback when the classifier LLM is down / times out."""
    issues: list[dict] = []
    for i, c in enumerate(clusters[:8]):
        level = str(c.level or "ERROR").upper()
        sev = _LEVEL_TO_SEV.get(level, "medium")
        svc = c.example_service or "unknown-service"
        sig = (c.signature or "error")[:80]
        slug = re.sub(r"[^a-z0-9]+", "-", f"{sig}-{svc}".lower()).strip("-")[:48] or f"issue-{i}"
        blob = " ".join(c.sample_lines[:3])
        issues.append(
            {
                "id": slug,
                "title": f"{level} in {svc}: {sig[:60]}",
                "category": _guess_category(f"{sig} {blob} {svc}"),
                "severity": sev,
                "severity_detail": {
                    "level": sev,
                    "confidence": 0.35,
                    "blast_radius": "single-service",
                    "user_impact": "degraded" if sev in ("critical", "high") else "none",
                    "escalation_needed": sev == "critical",
                    "reasoning": "Heuristic classification — OpenRouter classifier unavailable.",
                },
                "affected_service": svc,
                "summary": f"Detected from log cluster ({c.count}×). LLM classifier failed; using heuristic triage.",
                "evidence": list(c.sample_lines[:5]),
            }
        )
    return issues


def classifier_node(state: IncidentState) -> dict:
    entries = parse_logs(state["raw_logs"])
    clusters = cluster_errors(entries)

    if not clusters:
        return {
            "entries": [e.model_dump() for e in entries],
            "clusters": [],
            "issues": [],
            "trace": [trace_event("classifier", "No error/warning clusters found.")],
        }

    clusters_text = "\n\n".join(
        f"[{c.count}x] level={c.level} service={c.example_service} sig={c.signature}\n"
        + "\n".join(f"  {ln}" for ln in c.sample_lines)
        for c in clusters
    )

    print(
        f"[classifier] invoking structured LLM (timeout={_LLM_TIMEOUT_S}s) · "
        f"{len(clusters)} cluster(s)…",
        flush=True,
    )
    llm = get_llm().with_structured_output(ClassifierOutput, method="function_calling")
    prompt = CLASSIFY_PROMPT.format(clusters=clusters_text)

    issues: list[dict] = []
    llm_note = ""
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(llm.invoke, prompt)
            result: ClassifierOutput = fut.result(timeout=_LLM_TIMEOUT_S)
        issues = [i.model_dump() for i in result.issues]
        print(f"[classifier] LLM returned {len(issues)} issue(s)", flush=True)
    except FuturesTimeout:
        llm_note = f"LLM TIMEOUT after {_LLM_TIMEOUT_S}s"
        print(f"[classifier] {llm_note} — heuristic fallback", flush=True)
        issues = _issues_from_clusters(clusters)
    except Exception as exc:  # noqa: BLE001 — keep graph alive on OpenRouter 502/etc.
        llm_note = f"{type(exc).__name__}: {exc}"
        print(f"[classifier] LLM failed: {llm_note} — heuristic fallback", flush=True)
        issues = _issues_from_clusters(clusters)

    severity_counts: dict[str, int] = {}
    for i in issues:
        sev = i.get("severity", "unknown")
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

    msg = (
        f"Parsed {len(entries)} lines, {len(clusters)} clusters, "
        f"detected {len(issues)} issue(s). "
        f"Severity breakdown: {severity_counts}"
    )
    if llm_note:
        msg += f" [{llm_note}; used heuristic fallback]"

    return {
        "entries": [e.model_dump() for e in entries],
        "clusters": [c.model_dump() for c in clusters],
        "issues": issues,
        "trace": [
            trace_event(
                "classifier",
                msg,
                {
                    "issues": issues,
                    "severity_breakdown": severity_counts,
                    "llm_error": llm_note or None,
                    "heuristic": bool(llm_note),
                },
            )
        ],
    }
