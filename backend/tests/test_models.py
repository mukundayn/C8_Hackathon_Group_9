from app.models import JiraTicket


def test_jira_ticket_routing_defaults():
    t = JiraTicket(key="INC-1", url="http://x", summary="s", severity="critical", issue_id="i1")
    assert t.required_expertise == "General"
    assert t.routing_status == "routed"
    assert t.assignee is None


def test_jira_ticket_accepts_routing_metadata():
    t = JiraTicket(
        key="INC-2",
        url="http://x",
        summary="s",
        severity="high",
        issue_id="i2",
        required_expertise="DB",
        routing_status="assigned",
        assignee="You (active operator)",
        routing_explanation="matched",
    )
    assert t.required_expertise == "DB"
    assert t.routing_status == "assigned"
