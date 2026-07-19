from app.state import IncidentState
from app.integrations.slack_client import SlackNotifier
from app.nodes._trace import trace_event


def format_slack_message(
    issues: list[dict],
    tickets: list[dict],
    cookbook: dict | None = None,
) -> str:
    ticket_by_id = {t["issue_id"]: t for t in tickets if t.get("issue_id")}
    lines = [
        f":rotating_light: *Incident Analysis - {len(issues)} issue(s) (HITL approved)*",
        "",
    ]
    for i in issues:
        iid = i.get("id") or i.get("issue_id")
        link = (
            f" - <{ticket_by_id[iid]['url']}|{ticket_by_id[iid]['key']}>"
            if iid in ticket_by_id
            else ""
        )
        title = i.get("title") or "Untitled"
        sev = str(i.get("severity") or "?").upper()
        svc = i.get("affected_service") or "unknown"
        summary = i.get("summary") or ""
        lines.append(f"*{sev}* `{svc}` - {title}{link}")
        if summary:
            lines.append(f"    -> {summary}")
    if cookbook:
        lines += ["", f":clipboard: *Runbook:* {cookbook.get('title')} ({len(cookbook.get('items') or [])} steps)"]
    lines.append("")
    lines.append("_Posted after operator HITL approval (newly learned KB path)._")
    return "\n".join(lines)


def post_slack_for_issues(
    issues: list[dict],
    tickets: list[dict],
    cookbook: dict | None = None,
) -> dict:
    client = SlackNotifier()
    text = format_slack_message(issues, tickets, cookbook)
    result = client.post_message(text=text)
    return result.model_dump()


def notifier_node(state: IncidentState) -> dict:
    """Slack only when tickets already exist (post-HITL). Otherwise standby."""
    tickets = state.get("jira_tickets") or []
    pending = state.get("hitl_pending") or []

    if not tickets:
        msg = (
            f"Slack deferred — {len(pending)} issue(s) awaiting HITL approve."
            if pending
            else "Slack skipped — no HITL-approved tickets (KB HIT / no critical learn)."
        )
        return {
            "slack_result": {},
            "trace": [trace_event("notifier", msg, {"hitl_pending": len(pending)})],
        }

    issues = state.get("issues", [])
    result_data = post_slack_for_issues(issues, tickets, state.get("cookbook"))
    return {
        "slack_result": result_data,
        "trace": [trace_event(
            "notifier",
            f"Posted summary to {result_data.get('channel')}.",
            {"slack": result_data},
        )],
    }
