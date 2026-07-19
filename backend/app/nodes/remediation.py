import os

from app.state import IncidentState
from app.models import RemediationOutput
from app.llm import get_llm
from app.knowledge.query_builder import build_issue_query, build_filters_for_issue
from app.knowledge.confidence import retrieve_with_confidence
from app.config import config
from app.nodes._trace import trace_event

REMEDIATION_PROMPT = """You are an SRE proposing remediations for detected incidents.

Use the RETRIEVED RUNBOOKS below as authoritative guidance. Prefer their recommended steps.
For EACH issue, propose exactly one remediation with:
- issue_id (must match)
- fix_summary
- rationale: why this addresses the ROOT CAUSE (reference the runbook guidance where relevant)
- suggested_command: a concrete, SAFE command or config change
  (e.g. 'kubectl rollout undo deployment/user-service'). NEVER propose destructive commands
  (no 'rm -rf', 'drop database', 'DELETE FROM', 'terminate all').
- risk_level (low/medium/high)
- requires_approval: true for anything high-risk
- grounded_in: the titles of the runbooks you actually used for this issue

ISSUES:
{issues}

RETRIEVED RUNBOOKS:
{runbooks}
"""

_DANGEROUS = ("rm -rf", "drop database", "delete from", "terminate all", "mkfs", "> /dev")


_SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
# Cap per-issue RAG+rewrite work so large classifier outputs cannot stall the SSE stream.
_MAX_REMEDIATE_ISSUES = int(os.getenv("RAG_MAX_ISSUES", "3"))


def remediation_node(state: IncidentState) -> dict:
    issues = state.get("issues", [])
    if not issues:
        return {"remediations": [], "trace": [trace_event("remediation", "No issues to remediate.")]}

    # Prioritize critical/high; RAG-per-issue is expensive (embed + optional rewrite LLM).
    ranked = sorted(
        issues,
        key=lambda i: _SEV_RANK.get(str(i.get("severity", "")).lower(), 9),
    )
    work = ranked[: max(1, _MAX_REMEDIATE_ISSUES)]
    skipped = len(issues) - len(work)
    print(
        f"[remediation] start · {len(work)}/{len(issues)} issue(s) "
        f"(skipped {skipped} lower-severity) · RAG then 1 LLM call",
        flush=True,
    )

    # ---- Hybrid RAG + confidence gate (low score -> rewrite query -> re-retrieve) ----
    seen: dict[str, str] = {}
    grounding_by_issue: dict[str, list[str]] = {}
    retrieval_meta: dict[str, dict] = {}
    rewrites = 0

    for idx, i in enumerate(work, 1):
        print(
            f"[remediation] RAG {idx}/{len(work)} · id={i.get('id')} "
            f"sev={i.get('severity')} category={i.get('category')}",
            flush=True,
        )
        query = build_issue_query(i, sibling_issues=work)
        filters = build_filters_for_issue(i)
        docs, conf_meta = retrieve_with_confidence(
            query,
            issue=i,
            k=config.RAG_TOP_K,
            filters=filters or None,
        )
        if conf_meta.get("rewritten"):
            rewrites += 1
            print(f"[remediation]   query rewritten for {i.get('id')}", flush=True)

        titles = []
        for d in docs:
            title = d.metadata.get("original_title") or d.metadata.get("title", "runbook")
            source = d.metadata.get("source", "seed")
            label = f"{title}" if source == "seed" else f"{title} [{source}]"
            seen[label] = d.page_content
            titles.append(label)
        grounding_by_issue[i["id"]] = titles
        retrieval_meta[i["id"]] = {
            "filters": filters,
            "hybrid": config.RAG_USE_HYBRID,
            "rerank": config.RAG_USE_RERANK,
            "docs": titles,
            **conf_meta,
        }
        print(f"[remediation]   hits={len(titles)} · {titles[:2]}", flush=True)

    runbooks_text = "\n\n".join(f"[{title}]\n{content}" for title, content in seen.items()) \
        or "No matching runbooks found."

    issues_text = "\n".join(
        f"- id={i['id']} | {i['severity'].upper()} | {i['category']} | "
        f"{i['affected_service']} | {i['summary']}"
        for i in work
    )

    print("[remediation] invoking structured LLM for remediations…", flush=True)
    llm = get_llm(temperature=0.2).with_structured_output(RemediationOutput, method="function_calling")
    result: RemediationOutput = llm.invoke(
        REMEDIATION_PROMPT.format(issues=issues_text, runbooks=runbooks_text)
    )
    print(f"[remediation] LLM returned {len(result.remediations)} remediation(s)", flush=True)

    safe = [
        r.model_dump()
        for r in result.remediations
        if not any(bad in r.suggested_command.lower() for bad in _DANGEROUS)
    ]

    # Authoritative KB hit/miss from retrieval (not LLM-invented grounded_in names).
    hits = 0
    misses = 0
    for r in safe:
        iid = r.get("issue_id")
        titles = list(grounding_by_issue.get(iid) or [])
        if titles:
            r["kb_status"] = "hit"
            r["grounded_in"] = titles
            hits += 1
        else:
            r["kb_status"] = "miss"
            r["grounded_in"] = []
            misses += 1

    return {
        "remediations": safe,
        "trace": [trace_event(
            "remediation",
            f"Proposed {len(safe)} remediation(s) — KB HIT={hits} MISS={misses} "
            f"(retrieved chunks={len(seen)}, hybrid={config.RAG_USE_HYBRID}, "
            f"rerank={config.RAG_USE_RERANK}, query_rewrites={rewrites}).",
            {
                "remediations": safe,
                "retrieved_runbooks": grounding_by_issue,
                "retrieval": retrieval_meta,
                "kb_hits": hits,
                "kb_misses": misses,
            },
        )],
    }
