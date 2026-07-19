import os
from dotenv import load_dotenv

load_dotenv()


def _env(name: str, default: str = "") -> str:
    """Read env var and strip accidental wrapping quotes from .env editors."""
    raw = os.getenv(name, default)
    if raw is None:
        return default
    return str(raw).strip().strip('"').strip("'")


class Config:
    OPENROUTER_API_KEY = _env("OPENROUTER_API_KEY")
    OPENROUTER_BASE_URL = _env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    LLM_MODEL = _env("LLM_MODEL", "openai/gpt-4o-mini")
    LLM_TEMPERATURE = float(_env("LLM_TEMPERATURE", "0.1") or "0.1")

    EMBEDDING_MODEL = _env("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    CHROMA_DIR = _env("CHROMA_DIR", "./chroma_db")
    RAG_TOP_K = int(_env("RAG_TOP_K", "3") or "3")
    RAG_CANDIDATE_K = int(_env("RAG_CANDIDATE_K", "12") or "12")
    RAG_USE_HYBRID = _env("RAG_USE_HYBRID", "true").lower() in ("1", "true", "yes")
    RAG_USE_RERANK = _env("RAG_USE_RERANK", "true").lower() in ("1", "true", "yes")
    RAG_CHUNK_SIZE = int(_env("RAG_CHUNK_SIZE", "500") or "500")
    RAG_CHUNK_OVERLAP = int(_env("RAG_CHUNK_OVERLAP", "50") or "50")
    # After hybrid+rerank: if top score < threshold, rewrite query and retrieve once more.
    RAG_CONFIDENCE_THRESHOLD = float(_env("RAG_CONFIDENCE_THRESHOLD", "0.35") or "0.35")
    RAG_CONFIDENCE_REWRITE = _env("RAG_CONFIDENCE_REWRITE", "true").lower() in ("1", "true", "yes")

    SLACK_CHANNEL = _env("SLACK_CHANNEL", "#incidents")
    SLACK_CHANNEL_ID = _env("SLACK_CHANNEL_ID")
    SLACK_BOT_TOKEN = _env("SLACK_BOT_TOKEN")
    SLACK_WEBHOOK_URL = _env("SLACK_WEBHOOK_URL")

    JIRA_BASE_URL = _env("JIRA_BASE_URL").rstrip("/")
    JIRA_USER_EMAIL = _env("JIRA_USER_EMAIL")
    JIRA_API_TOKEN = _env("JIRA_API_TOKEN")
    JIRA_PROJECT_KEY = _env("JIRA_PROJECT_KEY", "INC")
    JIRA_ISSUE_TYPE = _env("JIRA_ISSUE_TYPE", "Task")
    JIRA_PRIORITY_ID = _env("JIRA_PRIORITY_ID")
    JIRA_DONE_TRANSITION_ID = _env("JIRA_DONE_TRANSITION_ID")

    # LangSmith
    LANGSMITH_API_KEY = _env("LANGSMITH_API_KEY")
    LANGSMITH_PROJECT = _env("LANGSMITH_PROJECT", "incident-suite-evals")

    # Webhook
    WEBHOOK_API_KEYS = _env("WEBHOOK_API_KEYS")

    # HF
    HF_TOKEN = _env("HF_TOKEN")

    @property
    def use_real_jira(self) -> bool:
        return bool(self.JIRA_BASE_URL and self.JIRA_USER_EMAIL and self.JIRA_API_TOKEN)

    @property
    def use_real_slack(self) -> bool:
        return bool(self.SLACK_BOT_TOKEN or self.SLACK_WEBHOOK_URL)


config = Config()
if not config.OPENROUTER_API_KEY:
    print(
        "[config] OPENROUTER_API_KEY unset — UI operators must paste their own key on login. "
        "Webhook/ingest LLM paths need a server key or a key in the request.",
        flush=True,
    )
else:
    print(
        f"[config] integrations · jira={'LIVE' if config.use_real_jira else 'MOCK'} "
        f"slack={'LIVE' if config.use_real_slack else 'MOCK'}",
        flush=True,
    )

if config.LANGSMITH_API_KEY:
    os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
    os.environ.setdefault("LANGCHAIN_PROJECT", config.LANGSMITH_PROJECT)
    os.environ.setdefault("LANGSMITH_API_KEY", config.LANGSMITH_API_KEY)
