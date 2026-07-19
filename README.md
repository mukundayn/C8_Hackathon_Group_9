# Netra.ai — Cognitive Observability Cockpit

An automated log-ops pipeline built with **LangGraph** orchestrating **5 specialized agents**. It ingests live application logs, diagnoses root causes via **RAG grounded in a Chroma runbook knowledge base**, and produces traceable remediations, action checklists, Slack alerts, and expertise-routed Jira tickets — all surfaced in a real-time operator cockpit UI.

The frontend is the **Netra.ai** cyber-HUD (React 19 + Tailwind v4), wired to the real Python backend (no simulated data). Authentication is real **Clerk Google OAuth**.

---

## Architecture

```
frontend/  React 19 + Vite 6 + Tailwind v4 (Netra cockpit)
  src/
    main.tsx                ClerkProvider entry
    AppRouter.tsx           Clerk route guard (/login, /login/sso-callback, /analyze)
    types.ts                shared backend + UI contracts
    lib/                    api.ts (SSE + REST client), sse.ts (parser), mappers.ts
    hooks/                  useAnalysis, useLiveEvents, useTraffic, useOperator
    auth/                   LoginPage (Netra look → Clerk OAuth + expertise picker)
    components/
      hud/                  Dashboard, MetricGauges
      flow/                 FlowChart (mapped to the 5 real agents)
      logs/                 LiveConsole (real webhook feed)
      charts/               TrafficChart (real /metrics/traffic)
      alerts/               AlertNotification
      results/              ResultsPanel (issues / remediations / cookbook)
      integrations/         SlackBoard, JiraBoard, WebhookConnector
    utils/                  audio.ts
    styles/                 index.css (Tailwind v4)

backend/   FastAPI + LangGraph
  app/
    main.py                 /analyze (SSE), /events/recent, /metrics/traffic, webhook mount
    graph.py                classifier → [image_analyzer] → remediation → [fallback] → cookbook → jira → notifier
    live_store.py           in-memory telemetry ring buffer + traffic aggregation + expertise map
    webhook.py              external ingestion (/webhook/ingest, /webhook/logs)
    nodes/                  agent implementations (jira.py does expertise routing)
    knowledge/              Chroma runbook store + RAG
  tests/                    pytest unit tests
```

### Data flow
1. **Upload** a `.log/.txt/.json` file (or a built-in template) → multipart `POST /api/analyze` with the operator's `expertise`.
2. Backend streams **SSE** `node` events per agent + a final `done` state. The UI maps node events onto the 5-stage flow chart and renders structured results.
3. **Jira tickets** are auto-routed: if an issue's category maps to the operator's expertise it's *assigned to you*, otherwise *routed* to the matching specialist queue.
4. **Live telemetry** (log console + traffic chart) is fed by real external events posted to the webhook connector (n8n, Datadog, Grafana, …), polled from `GET /api/events/recent` and `GET /api/metrics/traffic`.

> API routes are served under both bare paths and `/api/*`. In dev the Vite proxy strips `/api` → `:8000`; in prod FastAPI serves the SPA and `/api/*` from one origin.

---

## Local development

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # set OPENROUTER_API_KEY (+ optional HF_TOKEN, Clerk secret)
uvicorn app.main:app --reload --port 8000

# frontend (separate shell)
cd frontend
npm install
cp .env.example .env      # set CLERK_PUBLISHABLE_KEY
npm run dev               # http://localhost:5173
```

Or run both together: `./dev.sh` (requires a `.venv` and installed deps).

---

## Testing

| Layer | Tool | What it covers |
|-------|------|----------------|
| Backend units | `pytest` | live-store parsing & traffic aggregation, category→expertise map, Jira routing, model defaults, endpoint smoke (TestClient) |
| Frontend units | `vitest` | SSE frame parser, node→flow-stage mapper, live-event normalization, expertise heuristic |
| Quality eval | `backend/app/evals` | golden-set category/severity accuracy + keyword recall (demo quality gate) |
| CI | GitHub Actions | runs backend pytest + frontend typecheck/vitest/build on every PR |

```bash
cd backend && pip install -r requirements-dev.txt && pytest
cd frontend && npm run typecheck && npm test
```

The heavy pipeline deps (langgraph, chromadb, torch) are optional for the unit suite — endpoint tests skip gracefully if they're absent, so CI stays fast.

---

## Deployment (careful cutover)

Deploys as a **single Render web service** via `render.yaml`: the build compiles the frontend, copies `frontend/dist` → `backend/static`, and FastAPI serves the API + static UI.

1. **Blue-green**: deploy to a preview/second Render service first and smoke-test before touching production. Leave the AI Studio demo (`netra-ai.ai.studio`) untouched as a fallback showcase.
2. **Clerk**: add the deployment domain to **Allowed Origins** and configure the Google OAuth redirect URL `<domain>/login/sso-callback` *before* cutover — the most common live-auth breakage.
3. **Build compat**: `CLERK_PUBLISHABLE_KEY` must be present at build time (consumed by the Vite `define`); Tailwind v4 emits `dist/assets/` which matches FastAPI's `/assets` mount + SPA catch-all.
4. **Secrets** (set in the Render dashboard, `sync: false`): `OPENROUTER_API_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `HF_TOKEN`. No LLM keys are ever entered in the browser.
5. **Rollback**: Render retains prior deploys; keep the previous frontend build tagged for instant revert.
