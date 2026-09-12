"""HTTP integration tests for /v1/verifications (plan §18 P4 gate).

Runs against a real Postgres database (recoveryai_verification) — the same
"tests hit real Postgres, not mocks" rule the TS services follow. The
outbound callback to claims-service is captured via monkeypatching the
shared httpx client factory rather than requiring a live claims-service.
"""

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from recoveryai_common.observability import configure_logging
from recoveryai_common.runtime import (
    ReadinessRegistry,
    create_service_app,
    postgres_readiness_check,
)
from sqlalchemy import delete
from verification_service.db.models import VerificationRun, VerificationSignal
from verification_service.db.session import create_session_factory
from verification_service.internal_auth import (
    HEADER_SERVICE,
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    sign_internal_service_request,
)
from verification_service.routes.verifications import register_verification_routes
from verification_service.settings import SERVICE_NAME, load_settings

ENV = {
    "SERVICE_NAME": SERVICE_NAME,
    "PORT": "8001",
    "DATABASE_URL": "postgresql://recoveryai:recoveryai@localhost:5432/recoveryai_verification",
    "LOG_LEVEL": "fatal",
    "OTEL_TRACES_ENABLED": "false",
    "INTERNAL_SERVICE_SECRET": "integration-test-internal-secret-20",
    "INTERNAL_ALLOWED_CALLERS": "claims-service",
}


def _internal_headers(service: str = "claims-service") -> dict[str, str]:
    token = sign_internal_service_request(ENV["INTERNAL_SERVICE_SECRET"], service)
    return {
        HEADER_SERVICE: token.service,
        HEADER_TIMESTAMP: token.timestamp,
        HEADER_SIGNATURE: token.signature,
    }


def _client() -> TestClient:
    """Builds the app the same way `main.build_app()` does, but without
    importing that module — its `app = build_app()` line runs at import
    time against `os.environ`, which this test never wants to depend on."""
    settings = load_settings(dict(ENV))
    configure_logging(
        service=settings.service_name,
        environment=settings.environment,
        level=settings.python_log_level,
        pretty=settings.log_pretty,
    )
    readiness = ReadinessRegistry().register(postgres_readiness_check(str(settings.database_url)))
    session_factory = create_session_factory(str(settings.database_url))

    def configure(app: FastAPI) -> None:
        register_verification_routes(app, settings, session_factory)

    return TestClient(
        create_service_app(settings=settings, readiness=readiness, configure=configure)
    )


async def _reset_db() -> None:
    settings = load_settings(dict(ENV))
    session_factory = create_session_factory(str(settings.database_url))
    async with session_factory() as session, session.begin():
        await session.execute(delete(VerificationSignal))
        await session.execute(delete(VerificationRun))


def setup_function() -> None:
    import asyncio

    asyncio.run(_reset_db())


def _sample_body(city: str) -> dict[str, object]:
    return {
        "claimId": "11111111-1111-1111-1111-111111111111",
        "incidentType": "flood",
        "incidentAt": "2026-08-01T00:00:00+00:00",
        "location": {"city": city},
        "items": [{"description": "Sofa", "claimedValuePaise": 500000}],
        "evidenceDocumentIds": ["22222222-2222-2222-2222-222222222222"],
    }


def test_rejects_a_call_without_valid_internal_auth() -> None:
    client = _client()
    response = client.post("/v1/verifications", json=_sample_body("Chennai"))
    assert response.status_code == 403


def test_rejects_a_caller_not_on_the_allowlist() -> None:
    client = _client()
    response = client.post(
        "/v1/verifications",
        json=_sample_body("Chennai"),
        headers=_internal_headers("some-other-service"),
    )
    assert response.status_code == 403


@patch("verification_service.routes.verifications.traced_client")
def test_pass_persists_a_run_and_calls_back_claims_service(mock_traced_client: AsyncMock) -> None:
    mock_client = AsyncMock()
    mock_traced_client.return_value.__aenter__.return_value = mock_client

    client = _client()
    response = client.post(
        "/v1/verifications", json=_sample_body("Chennai"), headers=_internal_headers()
    )

    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "pass"
    assert body["overallScore"] >= 0.80
    assert body["requiresHumanReview"] is False
    assert len(body["signals"]) == 4

    mock_client.post.assert_called_once()
    call_args = mock_client.post.call_args
    assert (
        "/v1/internal/claims/11111111-1111-1111-1111-111111111111/verification-result"
        in call_args.args[0]
    )
    assert call_args.kwargs["json"]["decision"] == "pass"

    fetched = client.get(
        f"/v1/verifications/{body['verificationRunId']}", headers=_internal_headers()
    )
    assert fetched.status_code == 200
    assert fetched.json()["decision"] == "pass"
    assert len(fetched.json()["signals"]) == 4


@patch("verification_service.routes.verifications.traced_client")
def test_review_and_fail_fixtures_produce_the_documented_decisions(
    mock_traced_client: AsyncMock,
) -> None:
    mock_client = AsyncMock()
    mock_traced_client.return_value.__aenter__.return_value = mock_client
    client = _client()

    review = client.post(
        "/v1/verifications", json=_sample_body("Ambiguous City"), headers=_internal_headers()
    )
    assert review.json()["decision"] == "review"
    assert review.json()["requiresHumanReview"] is True

    fail = client.post(
        "/v1/verifications", json=_sample_body("Faketown"), headers=_internal_headers()
    )
    assert fail.json()["decision"] == "fail"


@patch("verification_service.routes.verifications.traced_client")
def test_latest_verification_for_claim(mock_traced_client: AsyncMock) -> None:
    mock_client = AsyncMock()
    mock_traced_client.return_value.__aenter__.return_value = mock_client
    client = _client()

    none_yet = client.get(
        "/v1/claims/33333333-3333-3333-3333-333333333333/latest-verification",
        headers=_internal_headers(),
    )
    assert none_yet.json() == {"run": None}

    body = _sample_body("Chennai")
    body["claimId"] = "33333333-3333-3333-3333-333333333333"
    client.post("/v1/verifications", json=body, headers=_internal_headers())

    latest = client.get(
        "/v1/claims/33333333-3333-3333-3333-333333333333/latest-verification",
        headers=_internal_headers(),
    )
    assert latest.json()["run"]["decision"] == "pass"
