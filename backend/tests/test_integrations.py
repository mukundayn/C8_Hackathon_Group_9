"""Integration clients: mock by default; real path shape via monkeypatch."""

from app.config import config
from app.integrations.jira_client import JiraTicketManager
from app.integrations.slack_client import SlackNotifier


def test_jira_create_mock_without_real_creds(monkeypatch):
    monkeypatch.setattr(config, "JIRA_BASE_URL", "")
    monkeypatch.setattr(config, "JIRA_USER_EMAIL", "")
    monkeypatch.setattr(config, "JIRA_API_TOKEN", "")
    assert config.use_real_jira is False
    mgr = JiraTicketManager()
    ticket = mgr.create_ticket(
        summary="Pool exhausted",
        description="test body",
        severity="critical",
        issue_id="iss-1",
    )
    assert ticket.issue_id == "iss-1"
    assert ticket.key.startswith(config.JIRA_PROJECT_KEY)
    assert mgr.last_create_was_real is False


def test_jira_create_real_path_via_monkeypatch(monkeypatch):
    monkeypatch.setattr(config, "JIRA_BASE_URL", "https://example.atlassian.net")
    monkeypatch.setattr(config, "JIRA_USER_EMAIL", "bot@example.com")
    monkeypatch.setattr(config, "JIRA_API_TOKEN", "token")
    monkeypatch.setattr(config, "JIRA_PROJECT_KEY", "HAC")
    assert config.use_real_jira is True

    mgr = JiraTicketManager()

    def fake_request(*, method, path, payload=None):
        assert method == "POST"
        assert path == "/rest/api/3/issue"
        assert payload["fields"]["summary"] == "Real ticket"
        return {"key": "HAC-42", "id": "10042"}

    monkeypatch.setattr(mgr, "_request", fake_request)
    ticket = mgr.create_ticket(
        summary="Real ticket",
        description="desc",
        severity="high",
        issue_id="qx-1",
    )
    assert ticket.key == "HAC-42"
    assert ticket.url.endswith("/browse/HAC-42")
    assert ticket.issue_id == "qx-1"
    assert mgr.last_create_was_real is True


def test_slack_mock_without_token(monkeypatch):
    monkeypatch.setattr(config, "SLACK_BOT_TOKEN", "")
    monkeypatch.setattr(config, "SLACK_WEBHOOK_URL", "")
    assert config.use_real_slack is False
    result = SlackNotifier().post_message(text="hello incident")
    assert result.text_preview == "hello incident"
    assert result.channel
    assert "mock.slack" in result.permalink or result.permalink


def test_slack_bot_path_via_monkeypatch(monkeypatch):
    monkeypatch.setattr(config, "SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setattr(config, "SLACK_CHANNEL_ID", "C123")
    monkeypatch.setattr(config, "SLACK_CHANNEL", "#c8-hackathon-group9")
    assert config.use_real_slack is True

    notifier = SlackNotifier()

    def fake_api(*, endpoint, payload):
        if endpoint == "chat.postMessage":
            return {"ok": True, "channel": "C123", "ts": "1710000000.000100"}
        if endpoint == "chat.getPermalink":
            return {"ok": True, "permalink": "https://slack.test/p/abc"}
        raise AssertionError(endpoint)

    monkeypatch.setattr(notifier, "_api_call", fake_api)
    result = notifier.post_message(text="HITL approved")
    assert result.permalink == "https://slack.test/p/abc"
    assert result.channel == "#c8-hackathon-group9"
    assert result.ts == "1710000000.000100"
