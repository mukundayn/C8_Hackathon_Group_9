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


def test_add_events_from_text_one_per_line():
    text = "ERROR db: pool exhausted\nINFO api: ok\n\nWARN cache: miss"
    n = live_store.add_events_from_text(text, source="n8n")
    assert n == 3
    events = live_store.recent()
    assert len(events) == 3
    assert {e["source"] for e in events} == {"n8n"}


def test_traffic_points_aggregates_errors():
    live_store.add_event(message="a", severity="error", timestamp="10:00:01")
    live_store.add_event(message="b", severity="info", timestamp="10:00:05")
    live_store.add_event(message="c", severity="critical", timestamp="10:01:00")
    points = live_store.traffic_points()
    by_time = {p["time"]: p for p in points}
    assert by_time["10:00"]["requests"] == 2
    assert by_time["10:00"]["errors"] == 1
    assert by_time["10:01"]["errors"] == 1


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
