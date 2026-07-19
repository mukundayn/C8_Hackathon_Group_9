"""Evaluator-facing pipeline demo: webhook → 4 issue levels → RAG + LangGraph.

Two entry points (wired in main / webhook):
  A) POST /api/webhook/logs  with ``{"pipeline_demo": true}`` (or /logs/demo)
  B) POST /api/debug/pipeline-demo

All evidence is printed to the server terminal with clear banners.
"""

from __future__ import annotations

import time
import traceback
import uuid
from typing import Any, Literal

from app.graph import graph
from app.knowledge.confidence import retrieve_with_confidence
from app.knowledge.query_builder import build_issue_query, build_filters_for_issue

Mode = Literal["full", "rag_only"]

# ── Hardcoded evaluation levels (printed one after another) ───────────────────

LEVELS: list[dict[str, Any]] = [
    {
        "level": 1,
        "domain": "memory",
        "title": "L1 · Memory / OOM",
        "issue": {
            "id": "oom-payment-service",
            "title": "Java heap OOM in payment-service",
            "category": "memory_leak",
            "severity": "high",
            "affected_service": "payment-service",
            "summary": "Process killed after OutOfMemoryError Java heap space.",
            "evidence": [
                "ERROR payment-service: java.lang.OutOfMemoryError: Java heap space",
                "FATAL kernel: Out of memory: Kill process 4421 (java)",
            ],
        },
        "log_text": (
            "2024-01-15T10:00:01Z ERROR [payment-service] java.lang.OutOfMemoryError: Java heap space\n"
            "2024-01-15T10:00:02Z FATAL [payment-service] process killed after GC thrashing\n"
            "2024-01-15T10:00:03Z WARN  [kubelet] OOMKilled container payment-service\n"
        ),
    },
    {
        "level": 2,
        "domain": "database",
        "title": "L2 · Database / pool exhaustion",
        "issue": {
            "id": "db-pool-orders",
            "title": "Postgres connection pool exhausted",
            "category": "database",
            "severity": "critical",
            "affected_service": "order-service",
            "summary": "Cannot acquire DB connection; pool exhausted under load.",
            "evidence": [
                "ERROR order-service: connection pool exhausted, timeout after 30000ms",
                "ERROR order-service: FATAL too many connections for role app",
            ],
        },
        "log_text": (
            "2024-01-15T11:00:01Z ERROR [order-service] connection pool exhausted, timeout after 30000ms\n"
            "2024-01-15T11:00:02Z ERROR [order-service] FATAL: too many connections for role \"app\"\n"
            "2024-01-15T11:00:03Z WARN  [order-service] checkout waited 28s for postgres connection\n"
        ),
    },
    {
        "level": 3,
        "domain": "network",
        "title": "L3 · Network / upstream timeout",
        "issue": {
            "id": "timeout-inventory",
            "title": "Upstream inventory timeout cascade",
            "category": "timeout",
            "severity": "high",
            "affected_service": "order-service",
            "summary": "Inventory checks timing out; cascading order failures.",
            "evidence": [
                "ERROR order-service: Failed to check inventory: connection timeout",
                "WARN order-service: Cascade: order creation failed due to inventory check timeout",
            ],
        },
        "log_text": (
            "2024-01-15T12:00:01Z ERROR [order-service] Failed to check inventory: connection timeout\n"
            "2024-01-15T12:00:02Z WARN  [order-service] Cascade: order creation failed due to inventory check timeout\n"
            "2024-01-15T12:00:03Z ERROR [api-gateway] upstream inventory-service timeout after 30s\n"
        ),
    },
    {
        "level": 4,
        "domain": "critical",
        "title": "L4 · Critical / customer-facing outage",
        "issue": {
            "id": "auth-outage",
            "title": "Auth service JWT verification flood / outage",
            "category": "auth",
            "severity": "critical",
            "affected_service": "auth-service",
            "summary": "Customer login failing; JWT verification errors spiking.",
            "evidence": [
                "CRITICAL auth-service: JWT verification flood — 98% error rate",
                "ERROR auth-service: unable to reach jwks endpoint",
            ],
        },
        "log_text": (
            "2024-01-15T13:00:01Z CRITICAL [auth-service] JWT verification flood — 98% error rate\n"
            "2024-01-15T13:00:02Z ERROR [auth-service] unable to reach jwks endpoint (timeout)\n"
            "2024-01-15T13:00:03Z CRITICAL [api-gateway] login endpoint returning 503 for all regions\n"
        ),
    },
]


def _banner(title: str, char: str = "=") -> None:
    line = char * 72
    print(f"\n{line}", flush=True)
    print(f"  {title}", flush=True)
    print(f"{line}", flush=True)


def _step(msg: str) -> None:
    print(f"  → {msg}", flush=True)


def _ok(msg: str) -> None:
    print(f"  ✓ {msg}", flush=True)


def _fail(msg: str) -> None:
    print(f"  ✗ {msg}", flush=True)


def _rag_for_issue(issue: dict[str, Any]) -> dict[str, Any]:
    """Run real RAG retrieval and print evidence for evaluators."""
    query = build_issue_query(issue)
    filters = build_filters_for_issue(issue)
    _step(f"RAG query: {query[:120]}{'…' if len(query) > 120 else ''}")
    if filters:
        _step(f"RAG filters: {filters}")

    t0 = time.perf_counter()
    docs, meta = retrieve_with_confidence(query, issue=issue, k=3, filters=filters or None)
    ms = int((time.perf_counter() - t0) * 1000)

    hits: list[dict[str, Any]] = []
    for i, d in enumerate(docs, 1):
        title = d.metadata.get("original_title") or d.metadata.get("title") or "runbook"
        source = d.metadata.get("source", "seed")
        snippet = (d.page_content or "").replace("\n", " ")[:140]
        hits.append({"rank": i, "title": title, "source": source, "snippet": snippet})
        print(f"     [{i}] {title}  (source={source})", flush=True)
        print(f"         {snippet}…", flush=True)

    metrics = meta.get("final_confidence") or meta.get("confidence") or {}
    conf = {
        "top": metrics.get("top"),
        "mean": metrics.get("mean"),
        "count": metrics.get("count"),
        "rewritten": meta.get("rewritten"),
    }
    if docs:
        _ok(f"RAG returned {len(docs)} hit(s) in {ms}ms  confidence={conf}")
    else:
        _fail(f"RAG returned 0 hits in {ms}ms  meta={conf}")

    return {"query": query, "ms": ms, "hits": hits, "confidence": conf, "ok": bool(docs)}


async def _graph_for_logs(log_text: str, label: str) -> dict[str, Any]:
    """Run real LangGraph astream and print each node completion."""
    thread_id = str(uuid.uuid4())
    initial = {
        "raw_logs": log_text,
        "filename": f"eval-{label}.log",
        "operator_expertise": ["DB", "Memory", "Network"],
        "trace": [],
    }
    run_config = {"configurable": {"thread_id": thread_id}}
    final = dict(initial)
    nodes: list[str] = []

    _step(f"LangGraph astream starting (thread={thread_id[:8]}…)")
    t0 = time.perf_counter()
    try:
        async for chunk in graph.astream(initial, run_config, stream_mode="updates"):
            for node_name, update in chunk.items():
                if not isinstance(update, dict):
                    continue
                nodes.append(node_name)
                for key, value in update.items():
                    if key == "trace":
                        final.setdefault("trace", []).extend(value or [])
                    else:
                        final[key] = value
                n_issues = len(final.get("issues") or [])
                n_rems = len(final.get("remediations") or [])
                print(
                    f"     ◆ node={node_name:<16}  issues={n_issues}  remediations={n_rems}",
                    flush=True,
                )
                for tr in (update.get("trace") or [])[-1:]:
                    msg = tr.get("message") if isinstance(tr, dict) else str(tr)
                    if msg:
                        print(f"       trace: {msg[:160]}", flush=True)
        ms = int((time.perf_counter() - t0) * 1000)
        _ok(
            f"LangGraph finished in {ms}ms · nodes={nodes} · "
            f"issues={len(final.get('issues') or [])} · "
            f"jira={len(final.get('jira_tickets') or [])}"
        )
        return {
            "ok": True,
            "ms": ms,
            "nodes": nodes,
            "issues": len(final.get("issues") or []),
            "remediations": len(final.get("remediations") or []),
            "jira_tickets": len(final.get("jira_tickets") or []),
            "has_cookbook": bool(final.get("cookbook")),
            "has_slack": bool(final.get("slack_result")),
        }
    except Exception as exc:
        ms = int((time.perf_counter() - t0) * 1000)
        _fail(f"LangGraph failed after {ms}ms · {type(exc).__name__}: {exc}")
        traceback.print_exc()
        return {
            "ok": False,
            "ms": ms,
            "nodes": nodes,
            "error": f"{type(exc).__name__}: {exc}",
        }


async def run_pipeline_demo(
    *,
    trigger: str,
    mode: Mode = "full",
) -> dict[str, Any]:
    """Print the 4-level evaluation demo to stdout; return a JSON-friendly summary."""
    _banner(f"NETRA EVAL · PIPELINE DEMO  ·  trigger={trigger}  ·  mode={mode}")
    print(
        "  Evidence plan: for each of 4 hardcoded issue levels → RAG retrieve → "
        + ("LangGraph astream" if mode == "full" else "RAG only (skip graph)"),
        flush=True,
    )
    print("  Watch this terminal — each LEVEL block is a pass/fail signal for judges.\n", flush=True)

    level_results: list[dict[str, Any]] = []
    t_all = time.perf_counter()

    for spec in LEVELS:
        _banner(f"LEVEL {spec['level']}/4  ·  {spec['title']}", char="-")
        print(f"  domain={spec['domain']}  issue_id={spec['issue']['id']}", flush=True)
        print(f"  severity={spec['issue']['severity']}  service={spec['issue']['affected_service']}", flush=True)

        rag = _rag_for_issue(spec["issue"])
        graph_result: dict[str, Any] | None = None
        if mode == "full":
            graph_result = await _graph_for_logs(spec["log_text"], spec["domain"])
        else:
            _step("Skipping LangGraph (mode=rag_only)")

        level_ok = rag.get("ok") and (mode == "rag_only" or (graph_result or {}).get("ok"))
        if level_ok:
            _ok(f"LEVEL {spec['level']}/4 PASS")
        else:
            _fail(f"LEVEL {spec['level']}/4 FAIL")

        level_results.append(
            {
                "level": spec["level"],
                "domain": spec["domain"],
                "title": spec["title"],
                "rag": rag,
                "graph": graph_result,
                "pass": bool(level_ok),
            }
        )

    total_ms = int((time.perf_counter() - t_all) * 1000)
    passed = sum(1 for r in level_results if r["pass"])
    _banner(
        f"DONE · {passed}/4 levels PASS · {total_ms}ms · trigger={trigger}",
        char="=",
    )
    for r in level_results:
        mark = "PASS" if r["pass"] else "FAIL"
        rag_n = len((r.get("rag") or {}).get("hits") or [])
        nodes = ((r.get("graph") or {}) or {}).get("nodes") or []
        print(f"  [{mark}] L{r['level']} {r['domain']:<10}  rag_hits={rag_n}  nodes={nodes}", flush=True)
    print("", flush=True)

    return {
        "status": "ok" if passed == 4 else "partial",
        "trigger": trigger,
        "mode": mode,
        "passed": passed,
        "total_levels": 4,
        "total_ms": total_ms,
        "levels": level_results,
    }


def print_webhook_ingest_banner(
    *,
    source: str,
    ingested: int,
    preview: str,
    pipeline_demo: bool,
) -> None:
    """Always-visible webhook ingest print (evaluation starts here for path A)."""
    _banner("WEBHOOK POST · /api/webhook/logs")
    print(f"  source={source!r}  ingested={ingested}", flush=True)
    preview_one_line = " ".join(preview.split())[:200]
    print(f"  preview: {preview_one_line}", flush=True)
    if pipeline_demo:
        _step("pipeline_demo=true → launching 4-level RAG + LangGraph evaluation next…")
    else:
        _step("Live buffer updated (no LLM). Add \"pipeline_demo\": true to run the 4-level eval.")
    print("", flush=True)
