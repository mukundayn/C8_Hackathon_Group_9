from langchain_openai import ChatOpenAI
from app.config import config
from app.openrouter_key import resolve_openrouter_api_key
import os


def get_llm(temperature: float | None = None) -> ChatOpenAI:
    """Chat model via OpenRouter (OpenAI-compatible). Model = openai/gpt-4o-mini.

    Uses the operator's bring-your-own key when present on the analyze request;
    otherwise falls back to OPENROUTER_API_KEY from the server env (webhooks/dev).
    """
    api_key = resolve_openrouter_api_key(config.OPENROUTER_API_KEY)
    if not api_key:
        raise RuntimeError(
            "No OpenRouter API key. Paste yours on the Netra login screen "
            "(or set OPENROUTER_API_KEY on the server for webhooks)."
        )
    timeout = float(os.getenv("LLM_REQUEST_TIMEOUT", "90"))
    return ChatOpenAI(
        model=config.LLM_MODEL,
        api_key=api_key,
        base_url=config.OPENROUTER_BASE_URL,
        temperature=config.LLM_TEMPERATURE if temperature is None else temperature,
        timeout=timeout,
        max_retries=1,
    )
