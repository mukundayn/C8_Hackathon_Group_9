from app.threat_score import attach_heuristic_threat_index, refine_threat_scores_llm


def test_attach_heuristic_stamps_source():
    issue = attach_heuristic_threat_index(
        {
            "id": "db-deadlock",
            "title": "Postgres deadlock",
            "severity": "critical",
            "category": "database",
            "affected_service": "orders-db",
            "summary": "Deadlock on orders table",
            "evidence": ["CRITICAL database: deadlock detected"],
        }
    )
    assert issue["threat_index_source"] == "heuristic"
    assert 0.5 <= issue["threat_index"] <= 10.0
    assert issue["threat_index_heuristic"] == issue["threat_index"]


def test_refine_without_critical_skips_llm_and_keeps_heuristic():
    issues = refine_threat_scores_llm(
        [
            {
                "id": "cache-miss",
                "title": "Cache miss",
                "severity": "low",
                "category": "cache",
                "affected_service": "cache",
                "summary": "optional header parse failed",
                "evidence": ["INFO cache: miss"],
            }
        ]
    )
    assert len(issues) == 1
    assert issues[0]["threat_index_source"] == "heuristic"
