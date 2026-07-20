from __future__ import annotations
import operator
from typing import Annotated, Any, TypedDict


class IncidentState(TypedDict, total=False):
    """Graph state uses plain JSON-serializable values only.

    Pydantic models are used at LLM / parsing boundaries, then dumped to dicts
    before writing into state so LangGraph checkpointing stays msgpack-safe.
    """

    # inputs
    raw_logs: str
    filename: str
    operator_expertise: list[str]   # e.g. ["DB", "Memory"] — drives Jira routing

    # image input (optional)
    # Prefer has_image + image_ref → image_store; avoid parking megabytes of
    # base64 in MemorySaver (Render OOM between classifier and remediation).
    has_image: bool             # True when a screenshot was attached this run
    image_ref: str              # key into app.image_store (bytes live outside graph)
    image_data: str             # legacy/base64 in-state (discouraged)
    image_mime: str             # e.g. image/png — used by vision request
    image_description: str      # text description of the image

    # classifier node
    entries: list[dict[str, Any]]
    clusters: list[dict[str, Any]]
    issues: list[dict[str, Any]]

    # image analysis node
    image_analysis: dict[str, Any] | None

    # later nodes
    remediations: list[dict[str, Any]]
    cookbook: dict[str, Any]
    jira_tickets: list[dict[str, Any]]
    slack_result: dict[str, Any]
    # Newly-learned critical/high awaiting operator approve before Jira/Slack
    hitl_pending: list[dict[str, Any]]

    # fallback node
    fallback_results: dict[str, Any] | None

    # audit trail (reducer = list concat so nodes append, not overwrite)
    trace: Annotated[list[dict], operator.add]
