"""Expertise-based Jira routing. Imports only the jira node (no graph / LLM)."""

from app.nodes.jira import jira_node


def _state(operator_expertise):
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
        "remediations": [],
        "operator_expertise": operator_expertise,
    }


def test_only_critical_and_high_get_tickets():
    out = jira_node(_state(["DB"]))
    ids = {t["issue_id"] for t in out["jira_tickets"]}
    assert ids == {"db-pool", "net-waf"}


def test_matching_expertise_is_assigned():
    out = jira_node(_state(["DB"]))
    db_ticket = next(t for t in out["jira_tickets"] if t["issue_id"] == "db-pool")
    assert db_ticket["required_expertise"] == "DB"
    assert db_ticket["routing_status"] == "assigned"
    assert "operator" in (db_ticket["assignee"] or "").lower()


def test_unmatched_expertise_routes_to_specialist():
    out = jira_node(_state(["DB"]))
    net_ticket = next(t for t in out["jira_tickets"] if t["issue_id"] == "net-waf")
    assert net_ticket["required_expertise"] == "Network"
    assert net_ticket["routing_status"] == "routed"
    assert net_ticket["routing_explanation"]


def test_empty_expertise_routes_everything_out():
    out = jira_node(_state([]))
    assert all(t["routing_status"] == "routed" for t in out["jira_tickets"])
