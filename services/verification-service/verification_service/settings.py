"""Configuration for the verification-service (plan Section 4.6)."""

import os
from typing import Annotated

from pydantic import BeforeValidator, Field
from pydantic_settings import NoDecode, SettingsConfigDict
from recoveryai_common.settings import BaseServiceSettings, ProviderSettings

SERVICE_NAME = "verification-service"
DEFAULT_PORT = "8001"


def _split_csv(value: object) -> object:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class VerificationServiceSettings(BaseServiceSettings, ProviderSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=True)

    # Shared with claims-service for the internal-service-authenticated
    # dispatch/callback pair (plan Section 2.5).
    internal_service_secret: str = Field(alias="INTERNAL_SERVICE_SECRET", min_length=20)
    # `NoDecode` + a `BeforeValidator`: pydantic-settings otherwise tries to
    # `json.loads()` any complex-typed env value before validators ever run,
    # which crashes on a plain comma-separated string like
    # "kyc-provider-mock,verification-service".
    internal_allowed_callers: Annotated[list[str], NoDecode, BeforeValidator(_split_csv)] = Field(
        default=["claims-service"], alias="INTERNAL_ALLOWED_CALLERS"
    )
    claims_service_url: str = Field(default="http://localhost:3003", alias="CLAIMS_SERVICE_URL")


def load_settings(source: dict[str, str] | None = None) -> VerificationServiceSettings:
    """Validate the environment, failing fast with every problem listed."""
    env = dict(os.environ if source is None else source)
    env.setdefault("SERVICE_NAME", SERVICE_NAME)
    env.setdefault("PORT", DEFAULT_PORT)
    return VerificationServiceSettings(**env)  # type: ignore[arg-type]
