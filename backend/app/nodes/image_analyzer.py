"""Image analysis node — reads screenshots and provides resolutions.

Uses a vision-capable LLM to analyze uploaded screenshots of dashboards,
error pages, terminal output, etc. and map them to known incident patterns.
"""

import base64
import logging
from pathlib import Path

from app.state import IncidentState
from app.models import ImageAnalysis
from app.llm import get_llm
from app.knowledge.runbook_store import retrieve
from app.nodes._trace import trace_event

logger = logging.getLogger(__name__)

TRAINING_IMAGES: list[dict] = [
    {
        "id": "train_01",
        "filename": "grafana_cpu_spike.png",
        "description": (
            "Grafana dashboard showing CPU usage at 98% on payment-service for the "
            "last 30 minutes. The graph shows a sharp spike at 14:32 UTC. Other "
            "services remain at normal levels (15-30%). Request latency panel shows "
            "p99 climbing from 200ms to 4500ms."
        ),
        "category": "cpu_saturation",
        "severity": "high",
        "resolution": [
            "Scale out payment-service horizontally: kubectl scale deployment/payment-service --replicas=5",
            "Check for hot-path loops: profile with async-profiler",
            "Enable CPU-based HPA: kubectl autoscale deployment/payment-service --cpu-percent=70",
            "Shed non-critical traffic via rate limiting",
        ],
    },
    {
        "id": "train_02",
        "filename": "oom_killed_terminal.png",
        "description": (
            "Terminal output showing 'java.lang.OutOfMemoryError: Java heap space' "
            "followed by 'Container killed due to OOM (exit code 137)'. "
            "kubectl get pods shows order-service in CrashLoopBackOff with 5 restarts. "
            "Container memory limit is set to 512Mi."
        ),
        "category": "memory_leak",
        "severity": "critical",
        "resolution": [
            "Increase memory limit: kubectl set resources deployment/order-service --limits=memory=1Gi",
            "Capture heap dump before restart: jmap -dump:live,format=b,file=heap.hprof <pid>",
            "Review recent deployments for memory regressions",
            "Add -XX:+HeapDumpOnOutOfMemoryError JVM flag",
        ],
    },
    {
        "id": "train_03",
        "filename": "datadog_error_rate.png",
        "description": (
            "Datadog APM dashboard showing error rate jump from 0.1% to 34% on "
            "user-service after deployment v2.4.1 at 10:15 UTC. Trace waterfall "
            "shows NullPointerException in UserController.getProfile(). Previous "
            "version v2.4.0 had 0% error rate."
        ),
        "category": "deployment_regression",
        "severity": "critical",
        "resolution": [
            "Rollback immediately: kubectl rollout undo deployment/user-service",
            "Verify error rate returns to baseline after rollback",
            "Reproduce NullPointerException in staging with v2.4.1",
            "Add null-safety regression test before next deploy",
        ],
    },
    {
        "id": "train_04",
        "filename": "db_connections_dashboard.png",
        "description": (
            "CloudWatch RDS dashboard showing active connections at 95/100 (max). "
            "Connection wait time graph shows exponential growth from 10ms to 8000ms. "
            "Several 'too many connections' errors visible in the log panel. "
            "The issue started 2 hours ago, correlating with a traffic spike."
        ),
        "category": "database",
        "severity": "high",
        "resolution": [
            "Increase max_connections in RDS parameter group",
            "Kill idle connections: SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle'",
            "Deploy PgBouncer as a connection pooler",
            "Check application code for connection leaks (missing close/finally)",
        ],
    },
    {
        "id": "train_05",
        "filename": "kubernetes_events.png",
        "description": (
            "kubectl get events output showing repeated 'FailedScheduling' events: "
            "'0/5 nodes are available: 5 Insufficient memory'. Multiple pods in "
            "Pending state for 15+ minutes. Node resource usage shows all nodes "
            "at 90%+ memory utilization."
        ),
        "category": "memory_leak",
        "severity": "high",
        "resolution": [
            "Add nodes to cluster: eksctl scale nodegroup --cluster=prod --nodes=8",
            "Review resource requests/limits for over-provisioned pods",
            "Enable cluster autoscaler if not configured",
            "Identify and fix memory-leaking pods consuming excess resources",
        ],
    },
    {
        "id": "train_06",
        "filename": "ssl_cert_error.png",
        "description": (
            "Browser showing 'NET::ERR_CERT_DATE_INVALID' error page. Certificate "
            "details show expiry date was 3 days ago. The domain is api.example.com. "
            "Multiple users reporting inability to access the service."
        ),
        "category": "certificate",
        "severity": "critical",
        "resolution": [
            "Renew certificate immediately via cert-manager or CA",
            "Restart ingress: kubectl rollout restart deployment/ingress-nginx-controller",
            "Set up cert-manager with Let's Encrypt auto-renewal",
            "Add certificate expiry monitoring with 30-day warning alerts",
        ],
    },
    {
        "id": "train_07",
        "filename": "kafka_consumer_lag.png",
        "description": (
            "Confluent Control Center showing consumer group 'order-processor' with "
            "lag of 2.3 million messages across 12 partitions. Lag trend is increasing "
            "at ~50k messages/minute. Consumer instances show 3/5 healthy."
        ),
        "category": "messaging",
        "severity": "high",
        "resolution": [
            "Scale consumer group: increase replicas to handle throughput",
            "Investigate 2 unhealthy consumers: check pod logs and health",
            "Temporarily increase fetch.max.bytes and max.poll.records",
            "Check downstream dependencies for slowness causing back-pressure",
        ],
    },
    {
        "id": "train_08",
        "filename": "disk_usage_alert.png",
        "description": (
            "PagerDuty alert page showing 'Disk Usage Critical' for node "
            "ip-10-0-1-42. Disk usage at 96% on /var/lib/docker. Alert has been "
            "firing for 45 minutes. Associated with pod eviction events."
        ),
        "category": "disk",
        "severity": "high",
        "resolution": [
            "Clean unused Docker images: docker system prune -a --volumes",
            "Clear old container logs: truncate -s 0 /var/lib/docker/containers/*/*-json.log",
            "Expand EBS volume and extend filesystem",
            "Set up log rotation and Docker image GC policies",
        ],
    },
    {
        "id": "train_09",
        "filename": "network_timeout_trace.png",
        "description": (
            "Jaeger distributed trace showing inventory-service call timing out "
            "after 30s. The span shows 'context deadline exceeded'. Upstream "
            "api-gateway has 3 retry attempts, each timing out. Total request "
            "duration: 92 seconds."
        ),
        "category": "timeout",
        "severity": "medium",
        "resolution": [
            "Check inventory-service health and resource utilization",
            "Reduce retry count and add circuit breaker: resilience4j or istio",
            "Set appropriate timeout: 5s with 1 retry instead of 30s with 3 retries",
            "Add p99 latency alerts per upstream service",
        ],
    },
    {
        "id": "train_10",
        "filename": "rate_limit_429.png",
        "description": (
            "Application logs showing repeated HTTP 429 responses from third-party "
            "payment API. Headers show 'X-RateLimit-Remaining: 0' and "
            "'Retry-After: 60'. Error count: 1,247 in the last 10 minutes. "
            "Payment processing queue is backing up."
        ),
        "category": "rate_limit",
        "severity": "medium",
        "resolution": [
            "Implement exponential backoff with jitter for API calls",
            "Add request caching for duplicate payment status checks",
            "Contact payment provider to request rate limit increase",
            "Implement a token bucket rate limiter on the client side",
        ],
    },
]

TEST_IMAGE: dict = {
    "id": "test_01",
    "filename": "test_elasticsearch_red.png",
    "description": (
        "Kibana cluster health page showing cluster status RED. "
        "3 unassigned shards visible. Index 'logs-2024.01.15' has "
        "status red with 0 active primary shards. JVM heap usage on "
        "data node es-data-2 is at 92%. Disk watermark breached on "
        "es-data-2 with 94% disk usage."
    ),
    "expected_category": "search",
    "expected_severity": "critical",
    "expected_resolution_keywords": [
        "unassigned shards",
        "disk watermark",
        "JVM heap",
        "reroute",
    ],
}

IMAGE_ANALYSIS_PROMPT = """You are a DevOps expert analyzing a screenshot from a monitoring/operations tool.

Based on the image description or content, identify:
1. What the screenshot shows (dashboard, terminal, error page, etc.)
2. Any error messages, anomalies, or critical indicators visible
3. The most likely issue category
4. Severity assessment (critical/high/medium/low/info)
5. Concrete resolution steps

KNOWN PATTERNS (from training):
{training_context}

RELEVANT RUNBOOKS:
{runbooks}

IMAGE CONTENT:
{image_content}

Provide your analysis as a structured ImageAnalysis."""


def _build_training_context() -> str:
    lines = []
    for t in TRAINING_IMAGES:
        lines.append(
            f"- [{t['category'].upper()}] {t['filename']}: {t['description'][:120]}... "
            f"→ severity={t['severity']}"
        )
    return "\n".join(lines)


def encode_image_base64(image_path: str) -> str | None:
    """Read an image file and return its base64-encoded content."""
    try:
        path = Path(image_path)
        if not path.exists():
            return None
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    except Exception as e:
        logger.warning("Failed to read image %s: %s", image_path, e)
        return None


def analyze_image_with_vision(
    image_path: str | None = None,
    image_base64: str | None = None,
    description: str = "",
) -> ImageAnalysis:
    """Analyze an image using the vision-capable LLM.

    Accepts either a file path or base64-encoded image data.
    Falls back to text-based analysis if vision is unavailable.
    """
    training_context = _build_training_context()

    query = description or "operations screenshot"
    runbook_docs = retrieve(query, k=3, use_hybrid=True, use_rerank=True)
    runbooks_text = "\n\n".join(
        f"[{d.metadata.get('title', 'runbook')}]\n{d.page_content}"
        for d in runbook_docs
    ) or "No matching runbooks found."

    image_content = description
    if image_path and not image_base64:
        image_base64 = encode_image_base64(image_path)

    if image_base64:
        try:
            llm = get_llm(temperature=0.2)
            # Strip accidental data-URL prefix; default mime when caller omits it.
            mime = "image/png"
            payload = image_base64
            if payload.startswith("data:") and "," in payload:
                header, payload = payload.split(",", 1)
                if header.startswith("data:"):
                    mime = header[5:].split(";", 1)[0] or mime
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": IMAGE_ANALYSIS_PROMPT.format(
                            training_context=training_context,
                            runbooks=runbooks_text,
                            image_content=image_content or "See attached image",
                        )},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{payload}",
                            },
                        },
                    ],
                }
            ]
            llm_structured = llm.with_structured_output(
                ImageAnalysis, method="function_calling"
            )
            return llm_structured.invoke(messages)
        except Exception as e:
            logger.warning("Vision analysis failed, using text fallback: %s", e)

    llm = get_llm(temperature=0.2).with_structured_output(
        ImageAnalysis, method="function_calling"
    )
    prompt = IMAGE_ANALYSIS_PROMPT.format(
        training_context=training_context,
        runbooks=runbooks_text,
        image_content=image_content,
    )
    return llm.invoke(prompt)


def image_analyzer_node(state: IncidentState) -> dict:
    """Graph node that processes attached images in the state."""
    image_data = state.get("image_data")
    image_description = state.get("image_description", "")
    image_mime = state.get("image_mime") or "image/png"

    if not image_data and not image_description:
        return {
            "image_analysis": None,
            "trace": [trace_event("image_analyzer", "No image provided, skipping.")],
        }

    # Prefer an explicit mime so JPEG/WebP screenshots are not forced to image/png.
    vision_payload = image_data
    if image_data and not str(image_data).startswith("data:"):
        vision_payload = f"data:{image_mime};base64,{image_data}"

    analysis = analyze_image_with_vision(
        image_base64=vision_payload,
        description=image_description,
    )
    analysis_dict = analysis.model_dump()

    new_issues = []
    if analysis.detected_errors:
        new_issues.append({
            "id": f"img-{analysis.category}",
            "title": f"Image: {analysis.description[:80]}",
            "category": analysis.category,
            "severity": analysis.severity,
            "severity_detail": {
                "level": analysis.severity,
                "confidence": analysis.confidence,
                "blast_radius": "unknown",
                "user_impact": "unknown",
                "escalation_needed": analysis.severity in ("critical", "high"),
                "reasoning": f"Detected from screenshot analysis: {len(analysis.detected_errors)} errors found",
            },
            "affected_service": "from-screenshot",
            "summary": analysis.description,
            "evidence": analysis.detected_errors,
        })
        from app.threat_score import refine_threat_scores_llm

        new_issues = refine_threat_scores_llm(new_issues)

    return {
        "image_analysis": analysis_dict,
        "issues": state.get("issues", []) + new_issues,
        "trace": [trace_event(
            "image_analyzer",
            f"Analyzed image: {analysis.category} ({analysis.severity}). "
            f"Found {len(analysis.detected_errors)} error(s). "
            f"Confidence: {analysis.confidence:.0%}",
            {"analysis": analysis_dict},
        )],
    }
