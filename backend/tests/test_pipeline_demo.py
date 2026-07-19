"""Smoke tests for the evaluator pipeline demo (no live LLM required)."""

from app.pipeline_demo import LEVELS, print_webhook_ingest_banner


def test_four_hardcoded_levels():
    assert len(LEVELS) == 4
    domains = [lv["domain"] for lv in LEVELS]
    assert domains == ["memory", "database", "network", "critical"]
    for lv in LEVELS:
        assert lv["issue"]["id"]
        assert lv["log_text"].strip()


def test_webhook_banner_prints(capsys):
    print_webhook_ingest_banner(
        source="eval",
        ingested=1,
        preview="CRITICAL auth-service: demo",
        pipeline_demo=True,
    )
    out = capsys.readouterr().out
    assert "WEBHOOK POST" in out
    assert "pipeline_demo=true" in out
