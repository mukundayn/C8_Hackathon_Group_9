from app.state import IncidentState
from app.integrations.jira_client import MockJiraClient
from app.live_store import expertise_for_category
from app.nodes._trace import trace_event

CRITICAL = {"critical", "high"}

# Specialist queue an unmatched ticket routes to, per expertise domain.
_SPECIALIST_QUEUE = {
    "DB": "Database On-Call (SRE-DB)",
    "Network": "Network Security (NetOps)",
    "Memory": "Platform / K8s (SRE-Core)",
    "CPU": "Compute / Capacity (SRE-Compute)",
    "General": "Incident Triage Queue",
}


def jira_node(state: IncidentState) -> dict:
    client = MockJiraClient()
    issues = [i for i in state.get("issues", []) if i["severity"] in CRITICAL]
    rem_by_id = {r["issue_id"]: r for r in state.get("remediations", [])}
    operator_expertise = {str(e).strip() for e in state.get("operator_expertise", []) if str(e).strip()}

    tickets = []
    for issue in issues:
        rem = rem_by_id.get(issue["id"])
        ticket = client.create_ticket(
            summary=issue["title"],
            severity=issue["severity"],
            issue_id=issue["id"],
            description=(
                f"{issue['summary']}\n\nAffected: {issue['affected_service']}\n"
                f"Proposed fix: {rem['fix_summary'] if rem else 'see checklist'}\n"
                f"Command: {rem['suggested_command'] if rem else 'n/a'}"
            ),
        )

        # Expertise-based intent routing.
        required = expertise_for_category(issue.get("category"))
        matched = required in operator_expertise
        ticket.required_expertise = required
        if matched:
            ticket.routing_status = "assigned"
            ticket.assignee = "You (active operator)"
            ticket.routing_explanation = (
                f"Category '{issue.get('category')}' maps to {required} expertise, "
                f"which matches your active profile — auto-assigned."
            )
        else:
            queue = _SPECIALIST_QUEUE.get(required, _SPECIALIST_QUEUE["General"])
            ticket.routing_status = "routed"
            ticket.assignee = queue
            ticket.routing_explanation = (
                f"Category '{issue.get('category')}' requires {required} expertise; "
                f"routed to {queue}."
            )

        tickets.append(ticket.model_dump())

    return {
        "jira_tickets": tickets,
        "trace": [trace_event(
            "jira",
            f"Created and routed {len(tickets)} JIRA ticket(s) for critical issues.",
            {"tickets": tickets},
        )],
    }
