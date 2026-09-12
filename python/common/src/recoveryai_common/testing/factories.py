"""Test helpers shared by the Python services."""

from typing import Any

from recoveryai_common.settings import BaseServiceSettings

_DEFAULTS = {
    "SERVICE_NAME": "test-service",
    "PORT": "8999",
    "DATABASE_URL": "postgresql://user:pass@localhost:5432/test",
    "LOG_LEVEL": "fatal",
    "OTEL_TRACES_ENABLED": "false",
}


def make_settings(**overrides: Any) -> BaseServiceSettings:
    """Build settings for a test without touching the process environment."""
    return BaseServiceSettings(**{**_DEFAULTS, **overrides})
