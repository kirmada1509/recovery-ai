"""Configuration for the agent-service (plan Section 4.6)."""

import os

from recoveryai_common.settings import BaseServiceSettings

SERVICE_NAME = "agent-service"
DEFAULT_PORT = "8002"


def load_settings(source: dict[str, str] | None = None) -> BaseServiceSettings:
    """Validate the environment, failing fast with every problem listed."""
    env = dict(os.environ if source is None else source)
    env.setdefault("SERVICE_NAME", SERVICE_NAME)
    env.setdefault("PORT", DEFAULT_PORT)
    return BaseServiceSettings(**env)  # type: ignore[arg-type]
