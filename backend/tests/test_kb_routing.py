"""KB HIT vs MISS routing after remediation."""

from app.graph import route_after_remediation


def test_kb_hit_skips_fallback():
    state = {
        "issues": [{"id": "a", "category": "database"}],
        "remediations": [
            {"issue_id": "a", "kb_status": "hit", "grounded_in": ["Pool runbook"]}
        ],
    }
    assert route_after_remediation(state) == "cookbook"


def test_kb_miss_routes_to_fallback():
    state = {
        "issues": [{"id": "b", "category": "unknown"}],
        "remediations": [
            {"issue_id": "b", "kb_status": "miss", "grounded_in": []}
        ],
    }
    assert route_after_remediation(state) == "fallback"


def test_ungrounded_routes_to_fallback():
    state = {
        "issues": [{"id": "c", "category": "network"}],
        "remediations": [{"issue_id": "c", "grounded_in": []}],
    }
    assert route_after_remediation(state) == "fallback"
