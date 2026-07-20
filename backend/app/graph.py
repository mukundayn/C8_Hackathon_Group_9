from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

from app.state import IncidentState
from app.routing import (
    route_after_classifier,
    route_after_remediation,
    route_by_severity,
)
from app.nodes.classifier import classifier_node
from app.nodes.image_analyzer import image_analyzer_node
from app.nodes.remediation import remediation_node
from app.nodes.fallback import fallback_node
from app.nodes.cookbook import cookbook_node
from app.nodes.jira import jira_node
from app.nodes.notifier import notifier_node

# Re-export routers for callers that still import from app.graph
__all__ = [
    "graph",
    "graph_ephemeral",
    "build_graph",
    "route_after_classifier",
    "route_after_remediation",
    "route_by_severity",
]


def build_graph(*, checkpointer: bool = True):
    g = StateGraph(IncidentState)

    g.add_node("classifier", classifier_node)
    g.add_node("image_analyzer", image_analyzer_node)
    g.add_node("remediation", remediation_node)
    g.add_node("fallback", fallback_node)
    g.add_node("cookbook", cookbook_node)
    g.add_node("jira", jira_node)
    g.add_node("notifier", notifier_node)

    g.add_edge(START, "classifier")
    g.add_conditional_edges(
        "classifier",
        route_after_classifier,
        {"image_analyzer": "image_analyzer", "remediation": "remediation"},
    )
    g.add_edge("image_analyzer", "remediation")
    g.add_conditional_edges(
        "remediation",
        route_after_remediation,
        {"fallback": "fallback", "cookbook": "cookbook"},
    )
    g.add_edge("fallback", "cookbook")
    g.add_conditional_edges(
        "cookbook",
        route_by_severity,
        {"jira": "jira", "notifier": "notifier"},
    )
    g.add_edge("jira", "notifier")
    g.add_edge("notifier", END)

    if checkpointer:
        return g.compile(checkpointer=MemorySaver())
    # Analyze SSE path: no MemorySaver — avoids checkpointing bulky state on
    # Render free tier (OOM mid-stream after classifier / vision).
    return g.compile()


graph = build_graph(checkpointer=True)
# One-shot cockpit / webhook streams — no thread checkpoints.
graph_ephemeral = build_graph(checkpointer=False)
