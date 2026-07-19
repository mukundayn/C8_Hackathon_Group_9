"""Pure LangGraph edge routers — no langgraph / LLM imports (CI-safe)."""

from __future__ import annotations

from typing import Any

CRITICAL = {"critical", "high"}


def route_after_classifier(state: dict[str, Any]) -> str:
    """Route to image analyzer if image data is present, otherwise to remediation."""
    if state.get("image_data") or state.get("image_description"):
        return "image_analyzer"
    return "remediation"


def route_by_severity(state: dict[str, Any]) -> str:
    """Conditional edge: go to JIRA only if there's a critical/high issue."""
    if any(i.get("severity") in CRITICAL for i in state.get("issues", [])):
        return "jira"
    return "notifier"


def route_after_remediation(state: dict[str, Any]) -> str:
    """KB hit → cookbook; KB miss / unknown / ungrounded → fallback (learn).

    Only inspect issues that received a remediation row. Remediation caps work
    via RAG_MAX_ISSUES (e.g. top 2 of 5) — uncapped issues must NOT force the
    learn path, or every multi-issue HIT run hangs in fallback.
    """
    issues = state.get("issues", [])
    rems = state.get("remediations", [])
    rem_by_id = {r.get("issue_id"): r for r in rems if isinstance(r, dict) and r.get("issue_id")}

    if not rem_by_id:
        # Nothing to learn from (LLM timeout / empty) — finish via cookbook.
        return "cookbook"

    considered = [i for i in issues if i.get("id") in rem_by_id]
    if not considered:
        # Remediations exist but ids don't match issues — treat as miss/learn.
        return "fallback"

    has_unknown = any(i.get("category") == "unknown" for i in considered)
    kb_miss = any(
        (rem_by_id.get(i.get("id")) or {}).get("kb_status") == "miss"
        or not (rem_by_id.get(i.get("id")) or {}).get("grounded_in")
        for i in considered
    )

    if has_unknown or kb_miss:
        return "fallback"
    return "cookbook"
