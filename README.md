# Netra.ai — Cognitive Observability Cockpit

**Hackathon product:** a real-time DevOps incident analysis suite.

Upload logs or screenshots (or stream lines via webhook) → a **LangGraph pipeline** classifies root causes, retrieves **RAG-grounded runbooks** from Chroma, proposes remediations, learns on KB miss, builds an incident cookbook, and — after **HITL** on newly learned criticals — files **expertise-routed Jira** tickets and posts **Slack**. Progress streams over SSE into the operator cockpit.

| Layer | Stack |
|-------|--------|
| Frontend | React 19 · Vite 6 · Tailwind v4 · Clerk Google OAuth · Recharts |
| Backend | FastAPI · LangGraph · LangChain · Chroma · OpenRouter (GPT-4o-mini) |
| Deploy | Single Render web service (`render.yaml`) — API + SPA from one origin |
| Repo | https://github.com/mukundayn/C8_Hackathon_Group_9 |

**Product pitch deck:** open [`docs/presentation.html`](docs/presentation.html) (arrow keys / click).

---

## Features

- **Clerk Google SSO** + per-operator **OpenRouter BYOK** (analyze bills the operator’s key)
- **Log upload** (`.log` / `.txt` / `.json`) and **screenshot upload** (`.png` / `.jpg` / …) → optional `image_analyzer`
- **SSE streaming** of LangGraph nodes into the live flowchart
- **Hybrid RAG** — Chroma runbooks, confidence rewrite, KB HIT vs MISS→LEARN
- **HITL** before Jira/Slack on newly learned critical/high issues
- **Jira + Slack** — real clients when `JIRA_*` / `SLACK_*` are set;
- **Live feed** — `POST /api/webhook/logs` fills Live Console / traffic / threat cards (**no LLM**); full triage = upload `/api/analyze` or `/api/webhook/ingest`
- **Hybrid threat scores** — fast signal score on ingest; LLM refine for critical/high during analyze
- **CI** — GitHub Actions: pytest + typecheck + vitest + frontend build

---

## Repository layout

```text
├── frontend/                 # Netra cockpit (Vite)
│   ├── src/
│   │   ├── auth/             # Clerk login + BYOK
│   │   ├── components/       # hud, flow, logs, charts, results, integrations
│   │   ├── hooks/            # useAnalysis, useLiveEvents, useTraffic, useOperator
│   │   ├── lib/              # api.ts, sse.ts, mappers.ts (+ tests)
│   │   └── styles/           # Tailwind v4 entry
│   └── package.json
├── backend/                  # FastAPI + LangGraph
│   ├── app/
│   │   ├── main.py           # /analyze, metrics, HITL, webhooks
│   │   ├── graph.py          # agent orchestration
│   │   ├── live_store.py     # telemetry ring buffer + threat scores
│   │   ├── threat_score.py   # heuristic + LLM refine
│   │   ├── webhook.py        # live feed + full ingest
│   │   ├── nodes/            # classifier, image_analyzer, remediation, …
│   │   ├── knowledge/        # Chroma RAG (seeded runbooks)
│   │   └── evals/            # golden-set helpers
│   ├── requirements.txt
│   └── tests/
├── docs/presentation.html
├── .github/workflows/ci.yml
├── render.yaml
├── build.sh / dev.sh
└── samples/                  # example log files
```

---

## Quick start (local)

### Prerequisites
- Node.js 20+
- Python 3.11–3.13 recommended
- Clerk app (Google OAuth) → publishable key (frontend) + secret (optional backend)
- Your own OpenRouter key for cockpit analyze (BYOK on login)

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Optional: OPENROUTER_API_KEY (host), CLERK_SECRET_KEY, HF_TOKEN, JIRA_*, SLACK_*
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Set CLERK_PUBLISHABLE_KEY
npm run dev
```

Open **http://localhost:5173** → Google sign-in → paste OpenRouter `sk-or-…` → upload a log or screenshot from `samples/`.

Or start both with `./dev.sh` (Unix; needs a repo-root or `backend/.venv`).

---

## Environment variables

### Frontend (`frontend/.env`)

| Variable | Required | Notes |
|----------|----------|--------|
| `CLERK_PUBLISHABLE_KEY` | Yes | Injected at **build time** via Vite `define` |
| `VITE_API_BASE_URL` | No | Empty = same-origin in prod; Vite proxies `/api` in dev |

### Backend (`backend/.env`)

| Variable | Required | Notes |
|----------|----------|--------|
| `OPENROUTER_API_KEY` | Optional | Host fallback; **cockpit `/analyze` requires operator BYOK** |
| `CLERK_SECRET_KEY` | Optional | Not used to gate API routes today (SPA auth only) |
| `HF_TOKEN` | **Yes on Render free** | HF Inference API embeddings under 512MB RAM |
| `JIRA_*` / `SLACK_*` | Optional | When set → LIVE integrations; else MOCK |
| `LLM_MODEL` | No | Default `openai/gpt-4o-mini` |
| `CHROMA_DIR` | No | Default `./chroma_db` |

Never commit real `.env` files (gitignored).

---

## API surface (prod = same origin under `/api`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/ping` | Connectivity |
| `POST` | `/api/analyze` | Log/image analyze → SSE (`node`, `done`); requires BYOK |
| `GET` | `/api/events/recent` | Live telemetry buffer |
| `GET` | `/api/metrics/traffic` | Traffic chart buckets |
| `GET` | `/api/metrics/hud` | Gauge rollups |
| `POST` | `/api/webhook/logs` | **Live feed only** (`mode=live_feed`, `runs_llm=false`) |
| `POST` | `/api/webhook/ingest` | Full LangGraph analysis via webhook |
| `POST` | `/api/webhook/test` | Probe → sample live event |
| `POST` | `/api/hitl/approve` | Approve newly learned → Jira + Slack |
| `GET` | `/api/integrations/status` | `real` / `mock` for Jira & Slack |

Dev: Vite proxies `/api/*` → `http://localhost:8000/*` (strips `/api`).

---

## Agent pipeline

```text
START
  → classifier              # parse / cluster / LLM issues + threat scores
  → [image_analyzer]        # if screenshot / image_data present
  → remediation             # RAG + confidence rewrite
  → [fallback]              # KB MISS → learn into Chroma
  → cookbook                # checklist
  → [jira]                  # critical/high; HITL may defer newly learned
  → notifier                # Slack (LIVE)
END
```

---

## Testing

```bash
cd backend && pip install -r requirements-dev.txt && pytest
cd frontend && npm run typecheck && npm test && npm run build
```

---

## Deploy on Render

1. Connect `mukundayn/C8_Hackathon_Group_9` → Blueprint (`render.yaml`) or Web Service.
2. Set secrets: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `HF_TOKEN`; optional host `OPENROUTER_API_KEY`, `JIRA_*`, `SLACK_*`.
3. Build copies frontend `dist` → `backend/static`; start uvicorn on `$PORT`.
4. Clerk: allowed origin + Google redirect `https://<render-host>/login/sso-callback`.

**Free tier:** cold start re-seeds Chroma; set `HF_TOKEN`; service sleeps after ~15 min idle.

---

## Demo script (judges)

1. Sign in with Google → paste OpenRouter BYOK → pick expertise.
2. Upload a sample from `samples/` (e.g. DB / auth log) — or a ops screenshot (PNG).
3. Watch the flowchart (classifier → … → notifier); note optional image / learn branches.
4. Show Results: issues, remediations, KB HIT vs LEARN, cookbook.
5. If HITL cards appear → Approve → LIVE/MOCK Jira + Slack boards.
6. `POST /api/webhook/logs` (or n8n) → Live Console + traffic update (**telemetry only**, not full analyze).

Pitch deck: **`docs/presentation.html`**.

---

## License / team

C8 Hackathon Group 9 — Netra.ai incident suite.
