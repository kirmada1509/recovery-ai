"""Configuration for the agent-service (plan Section 4.6)."""

import os
from typing import Annotated

from pydantic import BeforeValidator, Field
from pydantic_settings import NoDecode, SettingsConfigDict
from recoveryai_common.settings import BaseServiceSettings, ProviderSettings

SERVICE_NAME = "agent-service"
DEFAULT_PORT = "8002"


def _split_csv(value: object) -> object:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class AgentServiceSettings(BaseServiceSettings, ProviderSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=True)

    # Shared with claims-service for the internal-service-authenticated
    # dispatch/callback pair (plan Section 2.5).
    internal_service_secret: str = Field(alias="INTERNAL_SERVICE_SECRET", min_length=20)
    internal_allowed_callers: Annotated[list[str], NoDecode, BeforeValidator(_split_csv)] = Field(
        default=["claims-service"], alias="INTERNAL_ALLOWED_CALLERS"
    )
    claims_service_url: str = Field(default="http://localhost:3003", alias="CLAIMS_SERVICE_URL")
    evidence_service_url: str = Field(default="http://localhost:3004", alias="EVIDENCE_SERVICE_URL")


def load_settings(source: dict[str, str] | None = None) -> AgentServiceSettings:
    """Validate the environment, failing fast with every problem listed."""
    env = dict(os.environ if source is None else source)
    env.setdefault("SERVICE_NAME", SERVICE_NAME)
    env.setdefault("PORT", DEFAULT_PORT)
    return AgentServiceSettings(**env)  # type: ignore[arg-type]
