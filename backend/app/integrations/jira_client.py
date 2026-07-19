"""Jira client — real Atlassian REST when configured, otherwise mock.

Ported from bhtani/AI-hackathon integration layer (create path only for this pass).
"""

from __future__ import annotations

import base64
import itertools
import json
from urllib import error, request

from app.config import config
from app.models import JiraTicket


def _adf_text(text: str) -> dict:
    lines = text.splitlines() or [" "]
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "\n".join(lines)}]}
        ],
    }


class JiraTicketManager:
    """Create Jira issues (real or mock). Caller sets Netra routing fields after create."""

    _counter = itertools.count(101)

    def __init__(self) -> None:
        self.last_create_was_real = False

    def create_ticket(
        self,
        *,
        summary: str,
        description: str,
        severity: str,
        issue_id: str,
    ) -> JiraTicket:
        if config.use_real_jira:
            try:
                ticket = self._create_ticket_real(
                    summary=summary,
                    description=description,
                    severity=severity,
                    issue_id=issue_id,
                )
                self.last_create_was_real = True
                return ticket
            except Exception as exc:  # noqa: BLE001 — fall back for demo resilience
                print(f"[JIRA] real create failed, falling back to mock: {exc}", flush=True)
                self.last_create_was_real = False
        return self._create_ticket_mock(
            summary=summary,
            description=description,
            severity=severity,
            issue_id=issue_id,
        )

    def _create_ticket_real(
        self,
        *,
        summary: str,
        description: str,
        severity: str,
        issue_id: str,
    ) -> JiraTicket:
        fields: dict = {
            "project": {"key": config.JIRA_PROJECT_KEY},
            "summary": summary,
            "description": _adf_text(description),
            "issuetype": {"name": config.JIRA_ISSUE_TYPE},
            "labels": ["incident-suite", str(severity).lower(), f"issue-{issue_id}"],
        }
        if config.JIRA_PRIORITY_ID:
            fields["priority"] = {"id": config.JIRA_PRIORITY_ID}

        data = self._request(method="POST", path="/rest/api/3/issue", payload={"fields": fields})
        key = data["key"]
        print(f"[JIRA] created {key} ({severity}) {summary}", flush=True)
        return JiraTicket(
            key=key,
            url=f"{config.JIRA_BASE_URL}/browse/{key}",
            summary=summary,
            severity=severity,  # type: ignore[arg-type]
            issue_id=issue_id,
        )

    def _create_ticket_mock(
        self,
        *,
        summary: str,
        description: str,
        severity: str,
        issue_id: str,
    ) -> JiraTicket:
        num = next(self._counter)
        key = f"{config.JIRA_PROJECT_KEY}-{num}"
        base = config.JIRA_BASE_URL or "https://your-org.atlassian.net"
        print(f"[MOCK JIRA] created {key}  ({severity})  {summary}", flush=True)
        print(description, flush=True)
        return JiraTicket(
            key=key,
            url=f"{base}/browse/{key}",
            summary=summary,
            severity=severity,  # type: ignore[arg-type]
            issue_id=issue_id,
        )

    def _request(self, *, method: str, path: str, payload: dict | None = None) -> dict:
        raw_auth = f"{config.JIRA_USER_EMAIL}:{config.JIRA_API_TOKEN}".encode("utf-8")
        auth = base64.b64encode(raw_auth).decode("utf-8")
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = request.Request(
            f"{config.JIRA_BASE_URL}{path}",
            data=body,
            method=method,
            headers={
                "Authorization": f"Basic {auth}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            with request.urlopen(req, timeout=20) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc


# Back-compat alias used by older call sites / tests.
MockJiraClient = JiraTicketManager
