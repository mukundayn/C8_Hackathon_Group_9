"""Endpoint smoke tests via FastAPI TestClient.

The app import pulls in the LangGraph pipeline (embeddings / vector store), which
may be unavailable in a minimal CI image. We therefore import defensively and skip
rather than fail if those heavy optional deps aren't installed. The live-store /
routing logic is covered unconditionally by the other test modules.

TestClient is used WITHOUT its context manager on purpose so the startup lifespan
(which seeds the Chroma runbook store) does not run.
"""

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")


@pytest.fixture(scope="module")
def client():
    try:
        from app.main import app
    except Exception as exc:  # pragma: no cover - depends on optional heavy deps
        pytest.skip(f"app import unavailable in this environment: {exc}")
    from fastapi.testclient import TestClient

    return TestClient(app)


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_webhook_logs_feeds_recent_events(client):
    payload = {"source": "n8n", "message": "ERROR db: pool exhausted", "severity": "error", "service": "database-service"}
    res = client.post("/api/webhook/logs", json=payload)
    assert res.status_code == 200
    assert res.json()["ingested"] == 1

    recent = client.get("/api/events/recent").json()["events"]
    assert any(e["message"].startswith("ERROR db") for e in recent)


def test_metrics_traffic_shape(client):
    res = client.get("/api/metrics/traffic")
    assert res.status_code == 200
    assert "points" in res.json()


def test_bare_and_prefixed_paths_both_exist(client):
    # dev proxy strips /api → bare path; prod uses /api directly.
    assert client.get("/events/recent").status_code == 200
    assert client.get("/api/events/recent").status_code == 200
