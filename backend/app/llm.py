from langchain_openai import ChatOpenAI
from app.config import config
import os


def get_llm(temperature: float | None = None) -> ChatOpenAI:
    """Chat model via OpenRouter (OpenAI-compatible). Model = openai/gpt-4o-mini.

    To use real OpenAI:  remove base_url, set api_key to an OpenAI key.
    To use Anthropic:    pip install langchain-anthropic and return ChatAnthropic(...).
    Only this function changes when swapping providers.
    """
    timeout = float(os.getenv("LLM_REQUEST_TIMEOUT", "90"))
    return ChatOpenAI(
        model=config.LLM_MODEL,
        api_key=config.OPENROUTER_API_KEY,
        base_url=config.OPENROUTER_BASE_URL,
        temperature=config.LLM_TEMPERATURE if temperature is None else temperature,
        timeout=timeout,
        max_retries=1,
    )