"""Shared test fixtures / import guards.

`app.config` asserts OPENROUTER_API_KEY at import time, so we inject a dummy key
before any application module is imported. This lets deterministic unit tests run
without real credentials or network access.
"""

import os

os.environ.setdefault("OPENROUTER_API_KEY", "test-key-not-used")
os.environ.setdefault("SLACK_CHANNEL", "#incidents")
os.environ.setdefault("JIRA_PROJECT_KEY", "INC")
