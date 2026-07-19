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
    """KB hit → cookbook; KB miss / unknown / ungrounded → fallback (learn)."""
    issues = state.get("issues", [])
    rems = state.get("remediations", [])
    rem_by_id = {r.get("issue_id"): r for r in rems if isinstance(r, dict)}

    has_unknown = any(i.get("category") == "unknown" for i in issues)
    unresolved = any(i.get("id") not in rem_by_id for i in issues)
    kb_miss = any(
        (rem_by_id.get(i.get("id")) or {}).get("kb_status") == "miss"
        or not (rem_by_id.get(i.get("id")) or {}).get("grounded_in")
        for i in issues
        if i.get("id") in rem_by_id
    )

    if has_unknown or unresolved or kb_miss:
        return "fallback"
    return "cookbook"
