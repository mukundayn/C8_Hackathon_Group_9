"""Slack client — bot token, incoming webhook, or mock.

Ported from bhtani/AI-hackathon integration layer (team channel post).
"""

from __future__ import annotations

import json
import time
import uuid
from urllib import error, parse, request

from app.config import config
from app.models import SlackResult


class SlackNotifier:
    """Post team incident updates. Returns Netra `SlackResult`."""

    def post_message(self, *, text: str, channel: str | None = None) -> SlackResult:
        """Primary entry used by Netra notifier / HITL approve."""
        if config.SLACK_BOT_TOKEN:
            try:
                channel_id = config.SLACK_CHANNEL_ID or channel
                if not channel_id:
                    raise RuntimeError("SLACK_CHANNEL_ID is required for bot-token Slack posts")
                result = self._post_message_api(channel=channel_id, text=text)
                permalink = self._get_permalink(channel=result["channel"], ts=result["ts"])
                return SlackResult(
                    channel=config.SLACK_CHANNEL or channel_id,
                    ts=str(result.get("ts") or ""),
                    permalink=permalink or "",
                    text_preview=text,
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[SLACK] bot post failed, trying webhook/mock: {exc}", flush=True)

        if config.SLACK_WEBHOOK_URL:
            try:
                self._post_webhook(text=text)
                return SlackResult(
                    channel=config.SLACK_CHANNEL or "#incidents",
                    ts=f"{time.time():.6f}",
                    permalink="webhook://posted",
                    text_preview=text,
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[SLACK] webhook failed, falling back to mock: {exc}", flush=True)

        return self._mock_post(channel=channel or config.SLACK_CHANNEL, text=text)

    def post_team_message(self, *, text: str) -> SlackResult:
        return self.post_message(text=text)

    def _post_message_api(self, *, channel: str, text: str) -> dict:
        return self._api_call(
            endpoint="chat.postMessage",
            payload={"channel": channel, "text": text},
        )

    def _get_permalink(self, *, channel: str, ts: str) -> str:
        try:
            result = self._api_call(
                endpoint="chat.getPermalink",
                payload={"channel": channel, "message_ts": ts},
            )
            return str(result.get("permalink") or "")
        except Exception:  # noqa: BLE001
            return ""

    def _post_webhook(self, *, text: str) -> None:
        body = json.dumps({"text": text}).encode("utf-8")
        req = request.Request(
            config.SLACK_WEBHOOK_URL,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with request.urlopen(req, timeout=20):
            return None

    def _api_call(self, *, endpoint: str, payload: dict) -> dict:
        body = parse.urlencode(
            {
                key: json.dumps(value) if isinstance(value, (dict, list)) else value
                for key, value in payload.items()
            }
        ).encode("utf-8")
        req = request.Request(
            f"https://slack.com/api/{endpoint}",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {config.SLACK_BOT_TOKEN}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        try:
            with request.urlopen(req, timeout=20) as response:
                data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "unknown_slack_error"))
        return data

    def _mock_post(self, *, channel: str, text: str) -> SlackResult:
        ts = f"{time.time():.6f}"
        permalink = f"https://mock.slack.local/{uuid.uuid4().hex[:12]}"
        msg = f"[MOCK SLACK] -> {channel}\n{text}\n"
        try:
            print(msg, flush=True)
        except UnicodeEncodeError:
            print(msg.encode("ascii", errors="replace").decode("ascii"), flush=True)
        return SlackResult(
            channel=channel or "#incidents",
            ts=ts,
            permalink=permalink,
            text_preview=text,
        )


# Back-compat alias.
MockSlackClient = SlackNotifier
