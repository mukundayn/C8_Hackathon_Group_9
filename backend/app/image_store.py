"""Ephemeral image bytes for the current analyze run.

Keeping base64 out of LangGraph state avoids MemorySaver/msgpack bloat and
Render free-tier OOMs between classifier → image_analyzer → remediation.

Uses a process-local dict keyed by ``image_ref`` (not ContextVar) so worker
threads used by LangGraph still see the payload.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class PendingImage:
    data_b64: str
    mime: str
    description: str = ""
    created_at: float = 0.0


_LOCK = threading.Lock()
_PENDING: dict[str, PendingImage] = {}
# Drop abandoned uploads (client disconnect mid-run).
_TTL_S = 30 * 60


def _purge_stale(now: float | None = None) -> None:
    ts = now if now is not None else time.time()
    dead = [k for k, v in _PENDING.items() if ts - v.created_at > _TTL_S]
    for k in dead:
        _PENDING.pop(k, None)


def put_pending_image(
    ref: str,
    data_b64: str,
    mime: str = "image/png",
    description: str = "",
) -> None:
    if not ref or not data_b64:
        return
    with _LOCK:
        _purge_stale()
        _PENDING[ref] = PendingImage(
            data_b64=data_b64,
            mime=mime or "image/png",
            description=description or "",
            created_at=time.time(),
        )


def get_pending_image(ref: str | None) -> Optional[PendingImage]:
    if not ref:
        return None
    with _LOCK:
        return _PENDING.get(ref)


def pop_pending_image(ref: str | None) -> Optional[PendingImage]:
    if not ref:
        return None
    with _LOCK:
        return _PENDING.pop(ref, None)


def clear_pending_image(ref: str | None) -> None:
    if not ref:
        return
    with _LOCK:
        _PENDING.pop(ref, None)


def has_pending_image(ref: str | None) -> bool:
    img = get_pending_image(ref)
    return bool(img and (img.data_b64 or img.description))
