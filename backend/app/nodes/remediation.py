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


def remediation_node(state: IncidentState) -> dict:
    issues = state.get("issues", [])
    if not issues:
        return {"remediations": [], "trace": [trace_event("remediation", "No issues to remediate.")]}

    # ---- Hybrid RAG + confidence gate (low score -> rewrite query -> re-retrieve) ----
    seen: dict[str, str] = {}
    grounding_by_issue: dict[str, list[str]] = {}
    retrieval_meta: dict[str, dict] = {}
    rewrites = 0

    for i in issues:
        query = build_issue_query(i, sibling_issues=issues)
        filters = build_filters_for_issue(i)
        docs, conf_meta = retrieve_with_confidence(
            query,
            issue=i,
            k=config.RAG_TOP_K,
            filters=filters or None,
        )
        if conf_meta.get("rewritten"):
            rewrites += 1

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

    runbooks_text = "\n\n".join(f"[{title}]\n{content}" for title, content in seen.items()) \
        or "No matching runbooks found."

    issues_text = "\n".join(
        f"- id={i['id']} | {i['severity'].upper()} | {i['category']} | "
        f"{i['affected_service']} | {i['summary']}"
        for i in issues
    )

    llm = get_llm(temperature=0.2).with_structured_output(RemediationOutput, method="function_calling")
    result: RemediationOutput = llm.invoke(
        REMEDIATION_PROMPT.format(issues=issues_text, runbooks=runbooks_text)
    )

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
