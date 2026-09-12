"""Startup configuration validation (plan Section 4.6)."""

import pytest
from pydantic import ValidationError
from recoveryai_common.settings import BaseServiceSettings
from recoveryai_common.testing import make_settings

VALID = {
    "SERVICE_NAME": "verification-service",
    "PORT": "8001",
    "DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
}


def test_accepts_a_valid_environment() -> None:
    settings = BaseServiceSettings(**VALID)  # type: ignore[arg-type]
    assert settings.service_name == "verification-service"
    assert settings.port == 8001
    assert settings.log_level == "info"
    assert settings.otel_traces_enabled is True


def test_missing_database_url_fails_fast() -> None:
    with pytest.raises(ValidationError):
        BaseServiceSettings(SERVICE_NAME="x", PORT="8001")  # type: ignore[arg-type]


def test_rejects_out_of_range_port() -> None:
    with pytest.raises(ValidationError):
        BaseServiceSettings(**{**VALID, "PORT": "99999"})  # type: ignore[arg-type]


def test_rejects_non_postgres_database_url() -> None:
    with pytest.raises(ValidationError):
        BaseServiceSettings(**{**VALID, "DATABASE_URL": "mysql://localhost/db"})  # type: ignore[arg-type]


def test_log_level_maps_onto_python_levels() -> None:
    assert make_settings(LOG_LEVEL="warn").python_log_level == "WARNING"
    assert make_settings(LOG_LEVEL="fatal").python_log_level == "CRITICAL"
    assert make_settings(LOG_LEVEL="trace").python_log_level == "DEBUG"
