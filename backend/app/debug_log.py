"""Temporary SSE debug lines for the UI log strip (remove after testing).

Maps LangGraph node names → source files so the cockpit can show where logic lives.
"""

from __future__ import annotations

from typing import Any

from app.routing import route_after_remediation

# Real module paths (repo-relative) for evaluator / debug UI.
NODE_SOURCE_FILES: dict[str, str] = {
    "classifier": "backend/app/nodes/classifier.py",
    "image_analyzer": "backend/app/nodes/image_analyzer.py",
    "remediation": "backend/app/nodes/remediation.py",
    "fallback": "backend/app/nodes/fallback.py",
    "cookbook": "backend/app/nodes/cookbook.py",
    "jira": "backend/app/nodes/jira.py",
    "notifier": "backend/app/nodes/notifier.py",
}

GRAPH_SOURCE = "backend/app/graph.py"
MAIN_SOURCE = "backend/app/main.py"
RUNBOOK_SOURCE = "backend/app/knowledge/runbook_store.py"


def debug_line(
    *,
    message: str,
    file: str,
    node: str | None = None,
    level: str = "INFO",
) -> dict[str, Any]:
    return {
        "level": level,
        "file": file,
        "node": node,
        "message": message,
    }


def describe_node_update(node_name: str, update: dict[str, Any]) -> list[dict[str, Any]]:
    """Build crucial debug lines after a LangGraph node finishes."""
    src = NODE_SOURCE_FILES.get(node_name, GRAPH_SOURCE)
    lines: list[dict[str, Any]] = [
        debug_line(
            file=src,
            node=node_name,
            message=f"node complete | keys={sorted(k for k in update if k != 'trace')}",
        )
    ]

    if node_name == "remediation":
        rems = update.get("remediations") or []
        hits = sum(1 for r in rems if isinstance(r, dict) and r.get("kb_status") == "hit")
        misses = sum(1 for r in rems if isinstance(r, dict) and r.get("kb_status") == "miss")
        lines.append(
            debug_line(
                file=src,
                node=node_name,
                message=f"RAG path · KB HIT={hits} MISS={misses} (see kb_status on remediations)",
            )
        )
        # Approximate issues from rem rows — router ignores uncapped issues anyway.
        synthetic = {
            "issues": [
                {"id": r.get("issue_id"), "category": "database"}
                for r in rems
                if isinstance(r, dict) and r.get("issue_id")
            ],
            "remediations": rems,
        }
        dest = route_after_remediation(synthetic)
        lines.append(
            debug_line(
                file=GRAPH_SOURCE,
                node=node_name,
                message=f"edge · route_after_remediation → {dest} "
                f"(only remediated issues; uncapped extras ignored)",
            )
        )

    if node_name == "fallback":
        fb = update.get("fallback_results") or {}
        lines.append(
            debug_line(
                file=src,
                node=node_name,
                message=(
                    f"KB MISS → LEARN · processed={fb.get('processed')} "
                    f"patterns_learned={fb.get('patterns_learned')} → {RUNBOOK_SOURCE}"
                ),
            )
        )

    if node_name == "classifier":
        n_issues = len(update.get("issues") or [])
        lines.append(
            debug_line(
                file=src,
                node=node_name,
                message=f"classified {n_issues} issue(s) · next edge via route_after_classifier in {GRAPH_SOURCE}",
            )
        )

    if node_name == "image_analyzer":
        lines.append(
            debug_line(
                file=src,
                node=node_name,
                message="optional image branch taken · continuing to remediation",
            )
        )

    if node_name == "cookbook":
        lines.append(
            debug_line(
                file=GRAPH_SOURCE,
                node=node_name,
                message="edge · route_by_severity → jira (critical/high) or notifier",
            )
        )

    # Last trace line is often the most useful human summary.
    tr = update.get("trace") or []
    if tr and isinstance(tr[-1], dict) and tr[-1].get("message"):
        msg = str(tr[-1]["message"]).replace("\n", " ")[:220]
        lines.append(debug_line(file=src, node=node_name, message=f"trace · {msg}"))

    return lines
