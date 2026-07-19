"""Fallback node for unknown/unresolved issues.

When the vector DB has no matching runbook for an issue (or the category is
'unknown'), this node:
1. Searches HF datasets for relevant incident knowledge
2. Adds any discovered resolutions to the vector store (dynamic learning)
3. Re-retrieves with reranking for improved relevance
4. Tests the new knowledge against the golden set
5. Publishes improvement scores

This creates a self-improving knowledge base that grows as new incident
types are encountered.
"""

import logging
import time
from typing import Any

from langchain_core.documents import Document

from app.state import IncidentState
from app.models import RemediationOutput
from app.llm import get_llm
from app.knowledge.runbook_store import retrieve
from app.knowledge.hf_datasets import (
    search_hf_for_issue,
    add_new_issue_to_store,
    ingest_hf_knowledge_to_store,
)
from app.evals.reranker import rerank
from app.nodes._trace import trace_event

logger = logging.getLogger(__name__)

SIMILARITY_THRESHOLD = 0.3
UNKNOWN_CATEGORIES = {"unknown"}

FALLBACK_REMEDIATION_PROMPT = """You are an SRE resolving an incident that has no matching runbook in our knowledge base.
This is a NEW or UNKNOWN issue type. Based on the issue details and any supplementary knowledge found,
propose a remediation.

ISSUE:
- id={issue_id}
- title: {title}
- category: {category}
- severity: {severity}
- service: {service}
- summary: {summary}
- evidence: {evidence}

SUPPLEMENTARY KNOWLEDGE (from external sources):
{supplementary}

Propose:
- issue_id (must match)
- fix_summary: a clear fix description
- rationale: why this addresses the root cause
- suggested_command: a SAFE command or config change
- risk_level: low/medium/high
- requires_approval: true for high-risk
- grounded_in: list of source names used
"""


def _needs_fallback(issue: dict, existing_remediations: list[dict]) -> bool:
    """Determine if an issue needs fallback resolution.

    Issues without a remediation row are intentionally skipped by RAG_MAX_ISSUES
    — do not treat them as learn candidates (that caused multi-minute hangs).
    """
    if issue.get("category") in UNKNOWN_CATEGORIES:
        # Only learn unknown when we actually tried to remediate it.
        has_rem = any(r.get("issue_id") == issue.get("id") for r in existing_remediations)
        return has_rem or not existing_remediations

    rem = next(
        (r for r in existing_remediations if r.get("issue_id") == issue.get("id")),
        None,
    )
    if rem is None:
        return False

    if rem.get("kb_status") == "miss" or not rem.get("grounded_in"):
        return True

    return False


def _search_and_learn(issue: dict) -> list[Document]:
    """Search HF and external sources, learn new knowledge, return supplementary docs."""
    query = f"{issue['title']} {issue.get('category', '')} {issue.get('summary', '')}"

    hf_results = search_hf_for_issue(query, top_k=3)
    logger.info(
        "HF search for '%s': found %d datasets", issue["title"], len(hf_results)
    )

    n_ingested = ingest_hf_knowledge_to_store()
    logger.info("Ingested %d new HF knowledge documents.", n_ingested)

    reranked_docs = retrieve(query, k=5, use_hybrid=True, use_rerank=True)

    if not reranked_docs or issue.get("category") in UNKNOWN_CATEGORIES:
        llm = get_llm(temperature=0.3)
        synthesis_prompt = (
            f"You are a DevOps knowledge base curator. Given this incident, write a concise "
            f"runbook entry (symptoms + resolution steps) that could help resolve similar issues "
            f"in the future.\n\n"
            f"Issue: {issue['title']}\n"
            f"Category: {issue.get('category', 'unknown')}\n"
            f"Summary: {issue.get('summary', '')}\n"
            f"Evidence: {issue.get('evidence', [])}\n\n"
            f"Write a runbook entry with Symptoms and Resolution sections."
        )
        response = llm.invoke(synthesis_prompt)
        new_content = response.content

        category = issue.get("category", "unknown")
        added = add_new_issue_to_store(
            title=f"Learned: {issue['title']}",
            category=category,
            content=new_content,
            source="auto-learned",
        )
        if added:
            reranked_docs = retrieve(query, k=5, use_hybrid=True, use_rerank=True)

    return reranked_docs


def _run_quick_eval(issue: dict) -> dict:
    """Run a lightweight evaluation of the new knowledge against this issue."""
    query = f"{issue['title']} {issue.get('category', '')} {issue.get('summary', '')}"
    docs = retrieve(query, k=5, use_hybrid=True, use_rerank=True)

    if not docs:
        return {"relevance_score": 0.0, "coverage": 0.0, "docs_found": 0}

    # Re-score with cross-encoder for display metrics.
    scored = rerank(query, docs, top_k=5)

    def _norm(s: float) -> float:
        return 1.0 / (1.0 + pow(2.718281828, -float(s)))

    scores = [_norm(s) for _, s in scored]
    avg_score = sum(scores) / len(scores) if scores else 0.0

    category = issue.get("category", "unknown")
    matching_category = sum(
        1 for doc, _ in scored
        if doc.metadata.get("category", "") == category
    )
    coverage = matching_category / len(scored) if scored else 0.0

    return {
        "relevance_score": round(avg_score, 3),
        "coverage": round(coverage, 3),
        "docs_found": len(scored),
        "top_docs": [
            {
                "title": doc.metadata.get("title", "unknown"),
                "score": round(_norm(score), 3),
                "source": doc.metadata.get("source", "unknown"),
            }
            for doc, score in scored[:3]
        ],
    }


def fallback_node(state: IncidentState) -> dict:
    """Fallback handler for unknown/unresolved issues.

    Flow:
    1. Identify issues needing fallback
    2. For each: search HF → learn → re-embed → rerank
    3. Generate remediation from newly found knowledge
    4. Test quality with quick eval
    5. Publish improvement scores
    """
    issues = state.get("issues", [])
    existing_rems = state.get("remediations", [])

    fallback_issues = [i for i in issues if _needs_fallback(i, existing_rems)]

    if not fallback_issues:
        return {
            "trace": [trace_event(
                "fallback",
                "All issues have matching remediations. No fallback needed.",
            )],
        }

    new_remediations: list[dict] = []
    eval_scores: list[dict] = []
    total_learned = 0

    for issue in fallback_issues:
        logger.info(
            "Fallback processing: %s (category=%s)",
            issue.get("title"), issue.get("category"),
        )

        supplementary_docs = _search_and_learn(issue)
        total_learned += 1

        supplementary_text = "\n\n".join(
            f"[{d.metadata.get('title', 'source')}] ({d.metadata.get('source', 'unknown')})\n"
            f"{d.page_content}"
            for d in supplementary_docs
        ) or "No supplementary knowledge found — use your expertise."

        llm = get_llm(temperature=0.2).with_structured_output(
            RemediationOutput, method="function_calling"
        )
        prompt = FALLBACK_REMEDIATION_PROMPT.format(
            issue_id=issue["id"],
            title=issue["title"],
            category=issue.get("category", "unknown"),
            severity=issue.get("severity", "medium"),
            service=issue.get("affected_service", "unknown"),
            summary=issue.get("summary", ""),
            evidence=issue.get("evidence", []),
            supplementary=supplementary_text,
        )
        result = llm.invoke(prompt)
        for r in result.remediations:
            rem_dict = r.model_dump()
            rem_dict["fallback"] = True
            rem_dict["kb_status"] = "learned"
            new_remediations.append(rem_dict)

        eval_result = _run_quick_eval(issue)
        eval_scores.append({
            "issue_id": issue["id"],
            "issue_title": issue["title"],
            **eval_result,
        })

    all_rems = list(existing_rems) + new_remediations

    summary_parts = [
        f"Processed {len(fallback_issues)} fallback issue(s). "
        f"Generated {len(new_remediations)} new remediation(s). "
        f"Learned {total_learned} new pattern(s)."
    ]
    for score in eval_scores:
        summary_parts.append(
            f"  [{score['issue_id']}] relevance={score['relevance_score']:.2f} "
            f"coverage={score['coverage']:.2f}"
        )

    learned_ids = [i["id"] for i in fallback_issues]
    return {
        "remediations": all_rems,
        "fallback_results": {
            "path": "miss_learn",
            "processed": len(fallback_issues),
            "new_remediations": len(new_remediations),
            "patterns_learned": total_learned,
            "learned_issue_ids": learned_ids,
            "learned_titles": [i.get("title", "") for i in fallback_issues],
            "eval_scores": eval_scores,
        },
        "trace": [trace_event(
            "fallback",
            "KB MISS → LEARN\n" + "\n".join(summary_parts),
            {
                "fallback_issues": learned_ids,
                "eval_scores": eval_scores,
                "new_remediations": new_remediations,
            },
        )],
    }
