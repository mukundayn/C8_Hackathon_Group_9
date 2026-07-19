"""Hybrid threat scoring: fast heuristic first, LLM refine for critical/high during analyze."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.live_store import compute_threat_index

_REFINE_TIMEOUT_S = int(os.getenv("THREAT_REFINE_TIMEOUT", "25"))
_CRITICALISH = frozenset({"critical", "high"})

_REFINE_PROMPT = """You are an SRE scoring operator threat for a cockpit alert dial (0.0–10.0).

For each issue below, return a threat_index that reflects blast radius and urgency.
You are given a heuristic_score as a prior — adjust it using the title/summary/evidence,
but stay within ±2.0 of the heuristic unless the text clearly justifies a larger move
(e.g. confirmed customer outage or data-loss risk).

Rules:
- 9.0–10.0: active customer outage, data loss, security breach
- 7.5–8.9: severe degradation / critical infra failure, escalate soon
- 6.0–7.4: high severity but contained
- below 6.0: should be rare for critical/high inputs

ISSUES:
{issues}
"""


class _ThreatScoreItem(BaseModel):
    issue_id: str
    threat_index: float = Field(ge=0.0, le=10.0)
    rationale: str = ""


class _ThreatScoreOutput(BaseModel):
    scores: list[_ThreatScoreItem]


def _confidence(issue: dict[str, Any]) -> Optional[float]:
    detail = issue.get("severity_detail")
    if isinstance(detail, dict) and isinstance(detail.get("confidence"), (int, float)):
        return float(detail["confidence"])
    return None


def attach_heuristic_threat_index(issue: dict[str, Any]) -> dict[str, Any]:
    """Stamp every issue with an immediate signal score (source=heuristic)."""
    out = dict(issue)
    evidence = out.get("evidence") or []
    blob = " ".join(
        [
            str(out.get("title") or ""),
            str(out.get("summary") or ""),
            " ".join(str(e) for e in evidence[:5]),
        ]
    )
    score = compute_threat_index(
        severity=str(out.get("severity") or "INFO"),
        message=blob,
        category=str(out.get("category") or ""),
        service=str(out.get("affected_service") or ""),
        confidence=_confidence(out),
    )
    out["threat_index"] = score
    out["threat_index_source"] = "heuristic"
    out["threat_index_heuristic"] = score
    return out


def refine_threat_scores_llm(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """LLM-refine threat_index for critical/high only; leave others on heuristic.

    Safe on failure: returns heuristic-stamped issues unchanged in score source.
    """
    stamped = [attach_heuristic_threat_index(i) for i in issues]
    targets = [
        i
        for i in stamped
        if str(i.get("severity") or "").lower() in _CRITICALISH
    ]
    if not targets:
        return stamped

    lines: list[str] = []
    for i in targets:
        evidence = i.get("evidence") or []
        ev = " | ".join(str(e)[:120] for e in evidence[:3])
        lines.append(
            f"- id={i.get('id')}\n"
            f"  severity={i.get('severity')} category={i.get('category')}\n"
            f"  service={i.get('affected_service')}\n"
            f"  heuristic_score={i.get('threat_index_heuristic')}\n"
            f"  title={i.get('title')}\n"
            f"  summary={i.get('summary')}\n"
            f"  evidence={ev}"
        )

    try:
        from app.llm import get_llm

        llm = get_llm(temperature=0.1).with_structured_output(
            _ThreatScoreOutput, method="function_calling"
        )
        prompt = _REFINE_PROMPT.format(issues="\n".join(lines))
        with ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(llm.invoke, prompt)
            result: _ThreatScoreOutput = fut.result(timeout=_REFINE_TIMEOUT_S)
        by_id = {s.issue_id: s for s in result.scores}
        refined = 0
        for i in stamped:
            item = by_id.get(str(i.get("id") or ""))
            if not item:
                continue
            # Soft clamp toward heuristic so a wild LLM can't invent 10.0 for noise.
            prior = float(i.get("threat_index_heuristic") or i.get("threat_index") or 5.0)
            llm_score = float(item.threat_index)
            clamped = max(prior - 2.0, min(prior + 2.0, llm_score))
            i["threat_index"] = round(max(0.5, min(10.0, clamped)), 1)
            i["threat_index_source"] = "llm"
            i["threat_index_rationale"] = (item.rationale or "")[:240]
            refined += 1
        print(
            f"[threat_score] LLM refined {refined}/{len(targets)} critical/high issue(s)",
            flush=True,
        )
    except FuturesTimeout:
        print(
            f"[threat_score] LLM refine timeout after {_REFINE_TIMEOUT_S}s — heuristic kept",
            flush=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[threat_score] LLM refine skipped: {type(exc).__name__}: {exc}", flush=True)

    return stamped
