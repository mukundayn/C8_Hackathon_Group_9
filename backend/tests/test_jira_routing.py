"""HITL-gated Jira: auto-create is off; learned criticals go to hitl_pending."""

from app.nodes.jira import create_tickets_for_issues, jira_node, pending_hitl_issues


def _state(operator_expertise, *, learned_ids=None, kb_status=None):
    remediations = []
    if kb_status:
        remediations = [
            {
                "issue_id": "db-pool",
                "fix_summary": "scale pool",
                "suggested_command": "kubectl scale",
                "kb_status": kb_status,
                "fallback": kb_status == "learned",
                "grounded_in": ["runbook"] if kb_status == "hit" else [],
            },
            {
                "issue_id": "net-waf",
                "fix_summary": "block subnet",
                "kb_status": kb_status,
                "fallback": kb_status == "learned",
                "grounded_in": ["runbook"] if kb_status == "hit" else [],
            },
        ]
    return {
        "issues": [
            {
                "id": "db-pool",
                "title": "DB pool exhausted",
                "category": "database",
                "severity": "critical",
                "affected_service": "database-service",
                "summary": "Connection pool maxed out.",
            },
            {
                "id": "net-waf",
                "title": "WAF flood",
                "category": "network",
                "severity": "high",
                "affected_service": "firewall-waf",
                "summary": "Auth flood detected.",
            },
            {
                "id": "minor",
                "title": "Noisy log",
                "category": "config",
                "severity": "low",
                "affected_service": "api",
                "summary": "Cosmetic.",
            },
        ],
        "remediations": remediations,
        "operator_expertise": operator_expertise,
        "fallback_results": {"learned_issue_ids": learned_ids or []},
    }


def test_kb_hit_skips_auto_jira():
    out = jira_node(_state(["DB"], kb_status="hit"))
    assert out["jira_tickets"] == []
    assert out["hitl_pending"] == []


def test_learned_critical_goes_to_hitl_pending():
    out = jira_node(_state(["DB"], kb_status="learned", learned_ids=["db-pool", "net-waf"]))
    assert out["jira_tickets"] == []
    ids = {p["issue_id"] for p in out["hitl_pending"]}
    assert ids == {"db-pool", "net-waf"}


def test_create_tickets_after_hitl_assigns_expertise():
    state = _state(["DB"], kb_status="learned")
    pending = pending_hitl_issues(
        state["issues"], state["remediations"], ["db-pool", "net-waf"]
    )
    tickets = create_tickets_for_issues(pending, state["remediations"], ["DB"])
    ids = {t["issue_id"] for t in tickets}
    assert ids == {"db-pool", "net-waf"}
    db_ticket = next(t for t in tickets if t["issue_id"] == "db-pool")
    assert db_ticket["required_expertise"] == "DB"
    assert db_ticket["routing_status"] == "assigned"


def test_create_tickets_routes_unmatched():
    state = _state(["DB"], kb_status="learned")
    pending = [
        p for p in pending_hitl_issues(state["issues"], state["remediations"], ["net-waf"])
        if p["issue_id"] == "net-waf"
    ]
    tickets = create_tickets_for_issues(pending, state["remediations"], ["DB"])
    assert len(tickets) == 1
    net = tickets[0]
    assert net["required_expertise"] == "Network"
    assert net["routing_status"] == "routed"
