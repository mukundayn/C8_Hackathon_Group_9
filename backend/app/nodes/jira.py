"""Jira integration — tickets only after HITL approve for newly-learned criticals.

Pipeline `jira_node` no longer auto-creates tickets. KB HIT / known issues skip
Jira entirely. Newly learned critical/high issues are listed in `hitl_pending`
for operator approval; `create_tickets_for_issues` is called from the HITL API.
"""

from __future__ import annotations

from typing import Any

from app.integrations.jira_client import JiraTicketManager
from app.live_store import expertise_for_category
from app.nodes._trace import trace_event
from app.state import IncidentState

CRITICAL = {"critical", "high"}

# Specialist queue an unmatched ticket routes to, per expertise domain.
_SPECIALIST_QUEUE = {
    "DB": "Database On-Call (SRE-DB)",
    "Network": "Network Security (NetOps)",
    "Memory": "Platform / K8s (SRE-Core)",
    "CPU": "Compute / Capacity (SRE-Compute)",
    "General": "Incident Triage Queue",
}


def _is_learned(rem: dict[str, Any] | None) -> bool:
    if not rem:
        return False
    if rem.get("kb_status") == "learned" or rem.get("fallback"):
        return True
    return False


def pending_hitl_issues(
    issues: list[dict[str, Any]],
    remediations: list[dict[str, Any]],
    learned_issue_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Critical/high issues that were newly learned → require HITL before Jira/Slack."""
    rem_by_id = {r.get("issue_id"): r for r in remediations if isinstance(r, dict)}
    learned_ids = set(learned_issue_ids or [])
    pending: list[dict[str, Any]] = []
    for issue in issues:
        if issue.get("severity") not in CRITICAL:
            continue
        rem = rem_by_id.get(issue.get("id"))
        if _is_learned(rem) or issue.get("id") in learned_ids:
            pending.append(
                {
                    "issue_id": issue.get("id"),
                    "title": issue.get("title"),
                    "severity": issue.get("severity"),
                    "affected_service": issue.get("affected_service"),
                    "summary": issue.get("summary"),
                    "category": issue.get("category"),
                    "kb_status": "learned",
                    "fix_summary": (rem or {}).get("fix_summary"),
                    "suggested_command": (rem or {}).get("suggested_command"),
                }
            )
    return pending


def create_tickets_for_issues(
    issues: list[dict[str, Any]],
    remediations: list[dict[str, Any]] | None = None,
    operator_expertise: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Create + route Jira tickets for the given issues (used by HITL approve)."""
    client = JiraTicketManager()
    rem_by_id = {r.get("issue_id"): r for r in (remediations or []) if isinstance(r, dict)}
    expertise = {str(e).strip() for e in (operator_expertise or []) if str(e).strip()}

    tickets: list[dict[str, Any]] = []
    for issue in issues:
        rem = rem_by_id.get(issue.get("id")) or rem_by_id.get(issue.get("issue_id"))
        # HITL payload may already be a pending dict with issue_id as key
        issue_id = issue.get("id") or issue.get("issue_id")
        title = issue.get("title") or "Untitled"
        severity = issue.get("severity") or "high"
        service = issue.get("affected_service") or "unknown"
        summary = issue.get("summary") or ""
        category = issue.get("category")

        ticket = client.create_ticket(
            summary=title,
            severity=str(severity),
            issue_id=str(issue_id),
            description=(
                f"{summary}\n\nAffected: {service}\n"
                f"Proposed fix: {(rem or {}).get('fix_summary') or issue.get('fix_summary') or 'see checklist'}\n"
                f"Command: {(rem or {}).get('suggested_command') or issue.get('suggested_command') or 'n/a'}\n"
                f"KB path: newly learned (HITL approved)"
            ),
        )

        required = expertise_for_category(category)
        matched = required in expertise
        ticket.required_expertise = required
        if matched:
            ticket.routing_status = "assigned"
            ticket.assignee = "You (active operator)"
            ticket.routing_explanation = (
                f"Category '{category}' maps to {required} expertise, "
                f"which matches your active profile — auto-assigned."
            )
        else:
            queue = _SPECIALIST_QUEUE.get(required, _SPECIALIST_QUEUE["General"])
            ticket.routing_status = "routed"
            ticket.assignee = queue
            ticket.routing_explanation = (
                f"Category '{category}' requires {required} expertise; "
                f"routed to {queue}."
            )

        tickets.append(ticket.model_dump())
    return tickets


def jira_node(state: IncidentState) -> dict:
    """Defer Jira: only newly-learned critical/high need HITL; nothing auto-created."""
    issues = state.get("issues", [])
    remediations = state.get("remediations", [])
    fb = state.get("fallback_results") or {}
    learned_ids = list(fb.get("learned_issue_ids") or [])

    pending = pending_hitl_issues(issues, remediations, learned_ids)

    if pending:
        msg = (
            f"HITL required for {len(pending)} newly-learned critical/high issue(s). "
            "Jira/Slack deferred until operator approve."
        )
    else:
        msg = (
            "No Jira tickets — KB HIT / non-critical issues skip ticketing; "
            "no newly-learned criticals pending HITL."
        )

    return {
        "jira_tickets": [],
        "hitl_pending": pending,
        "trace": [trace_event("jira", msg, {"hitl_pending": [p["issue_id"] for p in pending]})],
    }
