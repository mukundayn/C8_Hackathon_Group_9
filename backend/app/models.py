from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field

Severity = Literal["critical", "high", "medium", "low", "info"]
IssueCategory = Literal[
    "memory_leak", "deployment_regression", "database", "network",
    "cpu_saturation", "timeout", "auth", "config", "dns",
    "certificate", "disk", "cache", "messaging", "search",
    "rate_limit", "container_crash", "container_image", "security",
    "monitoring", "load_balancer", "deadlock", "unknown",
]


# ---- parsing layer ----
class LogEntry(BaseModel):
    line_no: int
    timestamp: Optional[str] = None
    level: Optional[str] = None
    service: Optional[str] = None
    message: str
    raw: str


class ErrorCluster(BaseModel):
    signature: str
    count: int
    level: str
    example_service: Optional[str] = None
    sample_lines: list[str]
    line_numbers: list[int]


# ---- severity classification detail ----
class SeverityClassification(BaseModel):
    level: Severity
    confidence: float = Field(
        description="confidence score 0.0-1.0 for this severity assignment"
    )
    blast_radius: str = Field(
        description="scope of impact: 'single-service', 'multi-service', 'cluster-wide', 'customer-facing'"
    )
    user_impact: str = Field(
        description="how end-users are affected: 'none', 'degraded', 'partial-outage', 'full-outage'"
    )
    escalation_needed: bool = Field(
        description="whether this needs immediate escalation to senior on-call"
    )
    reasoning: str = Field(
        description="1-sentence justification for the severity assignment"
    )


# ---- classifier output (LLM structured output) ----
class DetectedIssue(BaseModel):
    id: str = Field(description="short slug id, e.g. 'oom-order-service'")
    title: str
    category: IssueCategory
    severity: Severity
    severity_detail: Optional[SeverityClassification] = Field(
        default=None,
        description="detailed severity classification with confidence and impact analysis",
    )
    affected_service: str
    summary: str = Field(description="1-2 sentence plain-English explanation")
    evidence: list[str] = Field(description="log lines that justify this issue")


class ClassifierOutput(BaseModel):
    issues: list[DetectedIssue]


# ---- remediation output (LLM structured output) ----
class Remediation(BaseModel):
    issue_id: str
    fix_summary: str
    rationale: str = Field(description="why this addresses the root cause")
    suggested_command: str = Field(description="a concrete, SAFE command or config change")
    risk_level: Literal["low", "medium", "high"]
    requires_approval: bool
    grounded_in: list[str] = Field(
        default_factory=list,
        description="titles of runbooks retrieved from the knowledge base that informed this fix",
    )


class RemediationOutput(BaseModel):
    remediations: list[Remediation]


# ---- cookbook output (LLM structured output) ----
class ChecklistItem(BaseModel):
    step: int
    action: str
    owner_hint: str = Field(description="which role/team, e.g. 'on-call SRE'")
    done_when: str = Field(description="how to know the step succeeded")


class Cookbook(BaseModel):
    title: str
    items: list[ChecklistItem]


Expertise = Literal["DB", "Network", "Memory", "CPU", "General"]


# ---- integration results ----
class JiraTicket(BaseModel):
    key: str
    url: str
    summary: str
    severity: Severity
    issue_id: str
    # Expertise-based intent routing (set by the jira node).
    required_expertise: Expertise = "General"
    routing_status: Literal["assigned", "routed"] = "routed"
    assignee: Optional[str] = None
    routing_explanation: Optional[str] = None


class SlackResult(BaseModel):
    channel: str
    ts: str
    permalink: str
    text_preview: str


# ---- image analysis ----
class ImageAnalysis(BaseModel):
    description: str = Field(description="what the screenshot shows")
    detected_errors: list[str] = Field(
        default_factory=list,
        description="error messages or anomalies visible in the image",
    )
    category: IssueCategory = Field(default="unknown")
    severity: Severity = Field(default="medium")
    resolution_steps: list[str] = Field(
        default_factory=list,
        description="recommended steps to resolve what is shown in the screenshot",
    )
    confidence: float = Field(
        default=0.5,
        description="confidence 0.0-1.0 in the analysis",
    )


# ---- eval models ----
class EvalCase(BaseModel):
    id: str
    input_log: str = Field(description="the input log text or query")
    expected_category: IssueCategory
    expected_severity: Severity
    expected_keywords: list[str] = Field(
        default_factory=list,
        description="keywords expected in the remediation",
    )
    description: str = ""


class EvalResult(BaseModel):
    case_id: str
    category_match: bool
    severity_match: bool
    keyword_recall: float = Field(description="fraction of expected keywords found in output")
    retrieval_relevance: float = Field(description="average similarity score of retrieved docs")
    latency_ms: float = 0.0
    passed: bool = False


class EvalSummary(BaseModel):
    total: int
    passed: int
    failed: int
    category_accuracy: float
    severity_accuracy: float
    avg_keyword_recall: float
    avg_retrieval_relevance: float
    avg_latency_ms: float


# ---- webhook models ----
class WebhookEvent(BaseModel):
    source: str = Field(description="name of the calling system, e.g. 'datadog', 'pagerduty'")
    event_type: str = Field(description="type of event: 'alert', 'incident', 'log_batch'")
    payload: dict = Field(description="raw event payload from the source system")
    timestamp: Optional[str] = None
    callback_url: Optional[str] = Field(
        default=None,
        description="URL to POST results back to when analysis completes",
    )


class WebhookResponse(BaseModel):
    request_id: str
    status: str
    message: str
    results: Optional[dict] = None