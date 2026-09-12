"""Health and configuration tests for the agent-service."""

import pytest
from agent_service.settings import SERVICE_NAME, load_settings
from fastapi.testclient import TestClient
from pydantic import ValidationError
from recoveryai_common.runtime import ReadinessCheck, ReadinessRegistry, create_service_app
from recoveryai_common.testing import make_settings

ENV = {
    "DATABASE_URL": "postgresql://user:pass@localhost:5432/recoveryai_agent",
    "LOG_LEVEL": "fatal",
    "OTEL_TRACES_ENABLED": "false",
}


def _client(readiness: ReadinessRegistry) -> TestClient:
    settings = make_settings(SERVICE_NAME=SERVICE_NAME, PORT="8002", **ENV)
    return TestClient(create_service_app(settings=settings, readiness=readiness))


def test_loads_configuration_with_defaults() -> None:
    settings = load_settings(dict(ENV))
    assert settings.service_name == SERVICE_NAME
    assert settings.port == 8002


def test_rejects_environment_without_database() -> None:
    with pytest.raises(ValidationError):
        load_settings({"LOG_LEVEL": "fatal"})


def test_serves_liveness() -> None:
    response = _client(ReadinessRegistry()).get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": SERVICE_NAME}


def test_ready_when_dependencies_pass() -> None:
    async def ok() -> None:
        return None

    registry = ReadinessRegistry().register(ReadinessCheck(name="stub", run=ok))
    response = _client(registry).get("/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_unready_when_postgres_is_unreachable() -> None:
    async def fail() -> None:
        raise RuntimeError("connection refused")

    registry = ReadinessRegistry().register(ReadinessCheck(name="postgres", run=fail))
    response = _client(registry).get("/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unavailable"
    assert "connection refused" in body["checks"][0]["detail"]


def test_optional_dependency_does_not_break_readiness() -> None:
    async def ok() -> None:
        return None

    async def fail() -> None:
        raise RuntimeError("provider disabled")

    registry = (
        ReadinessRegistry()
        .register(ReadinessCheck(name="postgres", run=ok))
        .register(ReadinessCheck(name="optional", run=fail, optional=True))
    )
    assert _client(registry).get("/health/ready").status_code == 200


def test_unknown_route_uses_the_error_envelope() -> None:
    response = _client(ReadinessRegistry()).get("/nope")
    assert response.status_code == 404
