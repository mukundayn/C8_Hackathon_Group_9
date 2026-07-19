# Netra.ai — Cognitive Observability Cockpit

**Hackathon product:** a real-time DevOps incident analysis suite.

Upload (or stream) application logs → a **5-agent LangGraph pipeline** classifies root causes, retrieves **RAG-grounded runbooks** from Chroma, proposes remediations, builds an incident cookbook, files **expertise-routed Jira tickets**, and posts a **Slack** summary — all streamed live over SSE into a cyber-HUD operator cockpit.

| Layer | Stack |
|-------|--------|
| Frontend | React 19 · Vite 6 · Tailwind v4 · Clerk Google OAuth · Recharts |
| Backend | FastAPI · LangGraph · LangChain · Chroma · OpenRouter (GPT-4o-mini) |
| Deploy | Single Render web service (`render.yaml`) — API + SPA from one origin |
| Repo | https://github.com/mukundayn/C8_Hackathon_Group_9 |

**Product pitch deck (interactive HTML):** open [`docs/presentation.html`](docs/presentation.html) in a browser (arrow keys / click to navigate).

---

## Features

- **Clerk Google SSO** — real OAuth (not a mock login); expertise preference drives Jira routing
- **Multipart log upload** + built-in incident templates
- **SSE streaming** of real LangGraph node events (`classifier → remediation → cookbook → jira → notifier`)
- **Structured results** — issues, RAG remediations, cookbook checklist
- **Live telemetry** — webhook ingest (`/api/webhook/logs`), live console, traffic chart
- **Expertise-based Jira routing** — assign to you or specialist queue
- **Slack notifier** — mock client with real message preview (swap for Slack SDK later)
- **CI** — GitHub Actions: pytest + typecheck + vitest + frontend build

---

## Repository layout

```text
├── frontend/                 # Netra cockpit (Vite)
│   ├── src/
│   │   ├── auth/             # Clerk login (Netra-styled)
│   │   ├── components/       # hud, flow, logs, charts, results, integrations
│   │   ├── hooks/            # useAnalysis, useLiveEvents, useTraffic, useOperator
│   │   ├── lib/              # api.ts, sse.ts, mappers.ts (+ tests)
│   │   └── styles/           # Tailwind v4 entry
│   └── package.json
├── backend/                  # FastAPI + LangGraph
│   ├── app/
│   │   ├── main.py           # /analyze, /events/recent, /metrics/traffic, webhooks
│   │   ├── graph.py          # agent orchestration
│   │   ├── live_store.py     # telemetry ring buffer + expertise map
│   │   ├── webhook.py        # external ingest
│   │   ├── nodes/            # classifier, remediation, cookbook, jira, notifier, …
│   │   ├── knowledge/        # Chroma RAG, hybrid search, confidence rewrite
│   │   └── evals/            # golden-set quality gate
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   └── tests/
├── docs/presentation.html    # Interactive product presentation
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
- Clerk app (Google OAuth enabled) → publishable + secret keys
- OpenRouter API key

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env → set OPENROUTER_API_KEY and CLERK_SECRET_KEY
# Optional locally / required on Render free tier: HF_TOKEN
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env → set CLERK_PUBLISHABLE_KEY
npm run dev
```

Open **http://localhost:5173** → Google sign-in → upload a log or pick a template.

Or start both with `./dev.sh` (Unix; needs a repo-root or `backend/.venv`).

---

## Environment variables

### Frontend (`frontend/.env`)

| Variable | Required | Notes |
|----------|----------|--------|
| `CLERK_PUBLISHABLE_KEY` | Yes | Injected at **build time** via Vite `define` |
| `VITE_API_BASE_URL` | No | Leave empty — same-origin in prod; Vite proxies `/api` in dev |

### Backend (`backend/.env`)

| Variable | Required | Notes |
|----------|----------|--------|
| `OPENROUTER_API_KEY` | Yes | LLM calls (asserted at import) |
| `CLERK_SECRET_KEY` | Recommended | Server-side session verification |
| `HF_TOKEN` | **Yes on Render free** | Uses HF Inference API for embeddings → stays under 512MB RAM |
| `LLM_MODEL` | No | Default `openai/gpt-4o-mini` |
| `CHROMA_DIR` | No | Default `./chroma_db` |
| `SLACK_CHANNEL` / `JIRA_PROJECT_KEY` | No | Mock integration labels |

Never commit real `.env` files (gitignored). Only `.env.example` is tracked.

---

## API surface (prod = same origin under `/api`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Health check |
| `POST` | `/api/analyze` | Multipart file + optional `expertise` → SSE (`node`, `done`) |
| `GET` | `/api/events/recent` | Live telemetry buffer |
| `GET` | `/api/metrics/traffic` | Traffic chart buckets |
| `POST` | `/api/webhook/logs` | Lightweight n8n / monitor ingest |
| `POST` | `/api/webhook/logs/demo` | **Eval path A** — webhook sample + 4-level RAG/LangGraph terminal demo |
| `POST` | `/api/webhook/ingest` | Full webhook + optional analysis |
| `GET` | `/api/debug/pipeline-demo` | Eval cheat-sheet (how to run the demo) |
| `POST` | `/api/debug/pipeline-demo` | **Eval path B** — same 4-level demo without webhook |

Dev: Vite proxies `/api/*` → `http://localhost:8000/*` (strips `/api`).

### Pipeline evaluation demo (terminal)

Start the backend in a **visible** terminal, then trigger **A** or **B**. Evidence prints as `LEVEL 1/4 … 4/4` with RAG hits and LangGraph node names.

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

```bash
# Path A — starts with WEBHOOK banner, then 4 levels
curl -X POST "http://localhost:8000/api/webhook/logs/demo"

# Or flag any logs POST:
curl -X POST "http://localhost:8000/api/webhook/logs" ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"ERROR db pool\",\"pipeline_demo\":true}"

# Path B — debug route only
curl -X POST "http://localhost:8000/api/debug/pipeline-demo?mode=full"

# Faster smoke (RAG only, skip LLM graph):
curl -X POST "http://localhost:8000/api/debug/pipeline-demo?mode=rag_only"
```

---

## Agent pipeline

```text
START
  → classifier          # parse / cluster / LLM issues
  → [image_analyzer]    # optional if image payload
  → remediation         # RAG + confidence rewrite
  → [fallback]          # unknown issues → HF learn path
  → cookbook            # checklist
  → jira                # critical/high + expertise routing
  → notifier            # Slack preview
END
```

---

## Testing

```bash
# Backend deterministic units
cd backend
pip install -r requirements-dev.txt
pytest

# Frontend
cd frontend
npm run typecheck
npm test
npm run build
```

| Layer | Tool | Coverage |
|-------|------|----------|
| Backend | pytest | live store, Jira routing, models, endpoint smoke |
| Frontend | vitest | SSE parser, node→stage mappers |
| Evals | `backend/app/evals` | golden-set accuracy (demo quality gate) |
| CI | `.github/workflows/ci.yml` | pytest + typecheck + vitest + build |

---

## Deploy on Render

1. Connect GitHub repo `mukundayn/C8_Hackathon_Group_9` → **Blueprint** (`render.yaml`) or Web Service.
2. Set secrets: `OPENROUTER_API_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `HF_TOKEN`.
3. Build: `npm install && npm run build` in `frontend/` → copy `dist` → `backend/static` → `pip install -r requirements.txt`.
4. Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
5. In **Clerk Dashboard**:
   - Allowed origin = your Render URL
   - Google OAuth redirect = `https://<render-host>/login/sso-callback`

**Free tier notes**
- Cold start re-seeds Chroma from code (`seed_if_empty`).
- Set `HF_TOKEN` so embeddings use the Inference API (avoid loading full local torch models into 512MB).
- Service sleeps after ~15 min idle; first request wakes it.

---

## Demo script (judges)

1. Sign in with Google → pick expertise (e.g. DB + Memory).
2. Load template **“DB Connection Pool Exhaustion”**.
3. Watch the 5-agent flow chart stream to 100%.
4. Show issues / remediations / cookbook in the results panel.
5. Point at Jira board (assigned vs routed) and Slack preview.
6. `POST` a sample to `/api/webhook/logs` → live console + traffic chart update.

Open **`docs/presentation.html`** for a full interactive walkthrough of the product story.

---

## License / team

C8 Hackathon Group 9 — Netra.ai incident suite.
