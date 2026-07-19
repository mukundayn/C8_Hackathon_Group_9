"""Per-request OpenRouter API key (bring-your-own-key).

UI operators paste their key on login; /analyze attaches it to the LangGraph
run config so each session bills their OpenRouter account — not the host's.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Optional

_request_key: ContextVar[Optional[str]] = ContextVar("openrouter_request_key", default=None)


def set_request_openrouter_key(key: Optional[str]):
    """Bind a key for the current async task / thread context. Returns a reset token."""
    cleaned = (key or "").strip() or None
    return _request_key.set(cleaned)


def reset_request_openrouter_key(token) -> None:
    _request_key.reset(token)


def resolve_openrouter_api_key(fallback: str = "") -> str:
    """Prefer request/run-scoped key, then optional server fallback."""
    # 1) Explicit request context (set by /analyze)
    keyed = _request_key.get()
    if keyed:
        return keyed

    # 2) LangGraph run configurable (survives worker threads)
    try:
        from langgraph.config import get_config

        cfg = get_config() or {}
        conf = cfg.get("configurable") or {}
        run_key = conf.get("openrouter_api_key")
        if isinstance(run_key, str) and run_key.strip():
            return run_key.strip()
    except Exception:
        pass

    return (fallback or "").strip()
