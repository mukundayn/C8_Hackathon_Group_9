from app import live_store


def setup_function():
    live_store.clear()


def test_add_event_normalizes_severity_and_category():
    ev = live_store.add_event(
        message="PostgreSQL connection pool exhausted",
        severity="fatal",
        service="database-service",
    )
    assert ev["severity"] == "CRITICAL"
    assert ev["category"] == "Database"
    assert ev["id"]
    assert ev["severity_score"] == 4
    assert ev["response_time_ms"] >= 1


def test_add_events_from_text_one_per_line():
    text = "ERROR db: pool exhausted\nINFO api: ok\n\nWARN cache: miss"
    n = live_store.add_events_from_text(text, source="n8n")
    assert n == 3
    events = live_store.recent()
    assert len(events) == 3
    assert {e["source"] for e in events} == {"n8n"}
    assert live_store.ingest_total() == 3
    assert all(e["response_time_ms"] >= 1 for e in events)


def test_ingest_total_increments_per_add():
    assert live_store.ingest_total() == 0
    live_store.add_event(message="a")
    live_store.add_event(message="b")
    assert live_store.ingest_total() == 2


def test_critical_count_rollup():
    live_store.add_event(message="a", severity="info")
    live_store.add_event(message="b", severity="critical")
    live_store.add_event(message="c", severity="CRITICAL")
    live_store.add_event(message="d", severity="error")
    assert live_store.critical_count() == 2


def test_avg_response_rolls_across_ingest_and_analyze():
    live_store.add_event(message="a", response_time_ms=10)
    live_store.add_event(message="b", response_time_ms=30)
    assert live_store.avg_response_ms() == 20
    live_store.record_analyze_ms(100)
    # (10 + 30 + 100) / 3
    assert live_store.avg_response_ms() == 47


def test_traffic_points_aggregates_volume_and_severity():
    live_store.add_event(message="a", severity="error", timestamp="10:00:01", response_time_ms=100)
    live_store.add_event(message="b", severity="info", timestamp="10:00:01", response_time_ms=50)
    live_store.add_event(message="c", severity="critical", timestamp="10:01:00", response_time_ms=200)
    points = live_store.traffic_points()
    by_time = {p["time"]: p for p in points}
    assert by_time["10:00:01"]["requests"] == 2
    assert by_time["10:00:01"]["volume_per_sec"] == 2
    assert by_time["10:00:01"]["errors"] == 1
    assert by_time["10:00:01"]["avg_response_ms"] == 75
    # ERROR=3, INFO=1 → mean 2.0
    assert by_time["10:00:01"]["avg_severity"] == 2.0
    assert by_time["10:01:00"]["errors"] == 1
    assert by_time["10:01:00"]["avg_severity"] == 4.0


def test_expertise_for_category_mapping():
    assert live_store.expertise_for_category("database") == "DB"
    assert live_store.expertise_for_category("network") == "Network"
    assert live_store.expertise_for_category("memory_leak") == "Memory"
    assert live_store.expertise_for_category("cpu_saturation") == "CPU"
    assert live_store.expertise_for_category("something_else") == "General"
    assert live_store.expertise_for_category(None) == "General"


def test_ring_buffer_caps_at_max():
    for i in range(250):
        live_store.add_event(message=f"line {i}")
    assert len(live_store.recent(1000)) <= 200
    assert live_store.ingest_total() == 250


def test_recent_returns_newest_first():
    live_store.add_event(message="first")
    live_store.add_event(message="second")
    live_store.add_event(message="third")
    msgs = [e["message"] for e in live_store.recent()]
    assert msgs[0] == "third"
    assert msgs[-1] == "first"
