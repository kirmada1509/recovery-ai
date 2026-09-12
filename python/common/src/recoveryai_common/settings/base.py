"""Startup configuration validation for Python services (plan Section 4.6).

Mirrors the TypeScript `@recoveryai/config-ts` schema so both runtimes read the
same environment. Invalid configuration raises before the app serves traffic.
"""

from typing import Literal

from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["trace", "debug", "info", "warn", "error", "fatal"]


class BaseServiceSettings(BaseSettings):
    """Environment shared by every Python service."""

    model_config = SettingsConfigDict(
        env_file=None,
        extra="ignore",
        case_sensitive=True,
    )

    service_name: str = Field(alias="SERVICE_NAME")
    environment: str = Field(default="local", alias="ENVIRONMENT")
    port: int = Field(alias="PORT", ge=1, le=65535)
    log_level: LogLevel = Field(default="info", alias="LOG_LEVEL")
    log_pretty: bool = Field(default=False, alias="LOG_PRETTY")
    database_url: PostgresDsn = Field(alias="DATABASE_URL")
    otel_exporter_otlp_endpoint: str | None = Field(
        default=None, alias="OTEL_EXPORTER_OTLP_ENDPOINT"
    )
    otel_traces_enabled: bool = Field(default=True, alias="OTEL_TRACES_ENABLED")
    enable_diagnostics_routes: bool = Field(default=False, alias="ENABLE_DIAGNOSTICS_ROUTES")
    diagnostics_downstream_url: str | None = Field(default=None, alias="DIAGNOSTICS_DOWNSTREAM_URL")

    @property
    def python_log_level(self) -> str:
        """Map the shared log-level vocabulary onto Python's."""
        mapping = {
            "trace": "DEBUG",
            "debug": "DEBUG",
            "info": "INFO",
            "warn": "WARNING",
            "error": "ERROR",
            "fatal": "CRITICAL",
        }
        return mapping[self.log_level]


class ProviderSettings(BaseSettings):
    """Provider selection (plan Section 2.10): deterministic local defaults."""

    model_config = SettingsConfigDict(extra="ignore", case_sensitive=True)

    disaster_provider: Literal["mock"] = Field(default="mock", alias="DISASTER_PROVIDER")
    geocoder_provider: Literal["mock"] = Field(default="mock", alias="GEOCODER_PROVIDER")
    image_analysis_provider: Literal["mock"] = Field(
        default="mock", alias="IMAGE_ANALYSIS_PROVIDER"
    )
    llm_provider: Literal["mock", "openai-compatible"] = Field(default="mock", alias="LLM_PROVIDER")
