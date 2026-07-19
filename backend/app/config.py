import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
    OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-4o-mini")
    LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.1"))

    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma_db")
    RAG_TOP_K = int(os.getenv("RAG_TOP_K", "3"))
    RAG_CANDIDATE_K = int(os.getenv("RAG_CANDIDATE_K", "12"))
    RAG_USE_HYBRID = os.getenv("RAG_USE_HYBRID", "true").lower() in ("1", "true", "yes")
    RAG_USE_RERANK = os.getenv("RAG_USE_RERANK", "true").lower() in ("1", "true", "yes")
    RAG_CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "500"))
    RAG_CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "50"))
    # After hybrid+rerank: if top score < threshold, rewrite query and retrieve once more.
    RAG_CONFIDENCE_THRESHOLD = float(os.getenv("RAG_CONFIDENCE_THRESHOLD", "0.35"))
    RAG_CONFIDENCE_REWRITE = os.getenv("RAG_CONFIDENCE_REWRITE", "true").lower() in ("1", "true", "yes")

    SLACK_CHANNEL = os.getenv("SLACK_CHANNEL", "#incidents")
    SLACK_CHANNEL_ID = os.getenv("SLACK_CHANNEL_ID", "")
    SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
    SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")

    JIRA_BASE_URL = os.getenv("JIRA_BASE_URL", "").rstrip("/")
    JIRA_USER_EMAIL = os.getenv("JIRA_USER_EMAIL", "")
    JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN", "")
    JIRA_PROJECT_KEY = os.getenv("JIRA_PROJECT_KEY", "INC")
    JIRA_ISSUE_TYPE = os.getenv("JIRA_ISSUE_TYPE", "Task")
    JIRA_PRIORITY_ID = os.getenv("JIRA_PRIORITY_ID", "")
    JIRA_DONE_TRANSITION_ID = os.getenv("JIRA_DONE_TRANSITION_ID", "")

    # LangSmith
    LANGSMITH_API_KEY = os.getenv("LANGSMITH_API_KEY", "")
    LANGSMITH_PROJECT = os.getenv("LANGSMITH_PROJECT", "incident-suite-evals")

    # Webhook
    WEBHOOK_API_KEYS = os.getenv("WEBHOOK_API_KEYS", "")

    # HF
    HF_TOKEN = os.getenv("HF_TOKEN", "")

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

if config.LANGSMITH_API_KEY:
    os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
    os.environ.setdefault("LANGCHAIN_PROJECT", config.LANGSMITH_PROJECT)
    os.environ.setdefault("LANGSMITH_API_KEY", config.LANGSMITH_API_KEY)
