import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

from app.state import IncidentState
from app.models import Cookbook
from app.llm import get_llm
from app.nodes._trace import trace_event

COOKBOOK_PROMPT = """You are writing an actionable incident-response checklist (runbook).

Given the detected issues and proposed remediations, produce an ORDERED checklist a first-responder
can follow end to end: contain first, then diagnose, then fix, then verify. Each step needs a step
number, an action, an owner_hint (role/team), and done_when (verification).

ISSUES:
{issues}

REMEDIATIONS:
{remediations}
"""

_LLM_TIMEOUT_S = int(os.getenv("COOKBOOK_LLM_TIMEOUT", "60"))


def cookbook_node(state: IncidentState) -> dict:
    issues = state.get("issues", [])
    rems = state.get("remediations", [])
    if not issues:
        return {"trace": [trace_event("cookbook", "No issues; skipped checklist.")]}

    print(f"[cookbook] invoking structured LLM (timeout={_LLM_TIMEOUT_S}s)…", flush=True)
    llm = get_llm(temperature=0.3).with_structured_output(Cookbook, method="function_calling")
    prompt = COOKBOOK_PROMPT.format(
        issues="\n".join(f"- {i['title']} ({i['severity']})" for i in issues),
        remediations="\n".join(f"- {r['issue_id']}: {r['fix_summary']}" for r in rems),
    )

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(llm.invoke, prompt)
            cookbook: Cookbook = fut.result(timeout=_LLM_TIMEOUT_S)
    except FuturesTimeout:
        print("[cookbook] LLM TIMEOUT — returning stub checklist", flush=True)
        stub = {
            "title": "Incident response (timeout stub)",
            "items": [
                {
                    "step": 1,
                    "action": "Review remediations in the Results panel; OpenRouter timed out building the checklist.",
                    "owner_hint": "on-call",
                    "done_when": "Manual checklist confirmed",
                }
            ],
        }
        return {
            "cookbook": stub,
            "trace": [
                trace_event(
                    "cookbook",
                    f"Timed out after {_LLM_TIMEOUT_S}s — stub checklist emitted.",
                    {"timeout": True},
                )
            ],
        }
    except Exception as exc:  # noqa: BLE001
        print(f"[cookbook] LLM failed: {exc}", flush=True)
        return {
            "trace": [trace_event("cookbook", f"Cookbook LLM failed: {exc}", {"error": str(exc)})],
        }

    cookbook_data = cookbook.model_dump()
    print(f"[cookbook] built {len(cookbook.items)} step(s)", flush=True)
    return {
        "cookbook": cookbook_data,
        "trace": [
            trace_event(
                "cookbook",
                f"Built checklist with {len(cookbook.items)} step(s).",
                {"cookbook": cookbook_data},
            )
        ],
    }
