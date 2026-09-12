"""HTTP integration tests for `/v1/agent/claims/*` (plan §18 P5 gate):
the workflow runs end to end, pauses when evidence is missing, and resumes
correctly once it's supplied. Runs against real Postgres
(recoveryai_agent); the evidence-service download and the claims-service
callback are mocked, matching verification-service's own test pattern.
"""

import uuid
from unittest.mock import AsyncMock, patch

from agent_service.db.session import create_session_factory
from agent_service.internal_auth import (
    HEADER_SERVICE,
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    sign_internal_service_request,
)
from agent_service.routes.agent import register_agent_routes
from agent_service.settings import SERVICE_NAME, load_settings
from fastapi import FastAPI
from fastapi.testclient import TestClient
from recoveryai_common.observability import configure_logging
from recoveryai_common.runtime import (
    ReadinessRegistry,
    create_service_app,
    postgres_readiness_check,
)

TEST_DATABASE_URL = "postgresql://recoveryai:recoveryai@localhost:5432/recoveryai_agent"

ENV = {
    "SERVICE_NAME": SERVICE_NAME,
    "PORT": "8002",
    "DATABASE_URL": TEST_DATABASE_URL,
    "LOG_LEVEL": "fatal",
    "OTEL_TRACES_ENABLED": "false",
    "INTERNAL_SERVICE_SECRET": "integration-test-internal-secret-20",
    "INTERNAL_ALLOWED_CALLERS": "claims-service",
    "EVIDENCE_SERVICE_URL": "http://evidence-service.invalid",
    "CLAIMS_SERVICE_URL": "http://claims-service.invalid",
}


def _internal_headers(service: str = "claims-service") -> dict[str, str]:
    token = sign_internal_service_request(ENV["INTERNAL_SERVICE_SECRET"], service)
    return {
        HEADER_SERVICE: token.service,
        HEADER_TIMESTAMP: token.timestamp,
        HEADER_SIGNATURE: token.signature,
    }


def _client() -> TestClient:
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
        register_agent_routes(app, settings, session_factory)

    return TestClient(
        create_service_app(settings=settings, readiness=readiness, configure=configure)
    )


def _start_body(
    claim_id: str, policy_id: str, item_ids: list[str], evidence_ids: list[str]
) -> dict:
    return {
        "claimId": claim_id,
        "userId": str(uuid.uuid4()),
        "incidentType": "flood",
        "incidentAt": "2026-08-01T00:00:00+00:00",
        "location": {"city": "Chennai"},
        "claimedAmountPaise": 500_00,
        "items": [
            {
                "id": item_id,
                "description": "Damaged sofa",
                "category": "furniture",
                "claimedValuePaise": 500_00,
            }
            for item_id in item_ids
        ],
        "evidenceDocumentIds": evidence_ids,
        "policyId": policy_id,
        "policyEvidenceDocumentId": str(uuid.uuid4()),
        "verificationDecision": "pass",
        "verificationOverallScore": 0.9,
        "verificationReasons": [],
    }


@patch("agent_service.routes.agent.traced_client")
@patch("agent_service.indexing.extract_pages")
@patch("agent_service.workflow.graph.traced_client")
def test_run_completes_when_evidence_covers_every_item(
    mock_graph_traced_client: AsyncMock,
    mock_extract_pages: AsyncMock,
    mock_notify_traced_client: AsyncMock,
) -> None:
    mock_extract_pages.return_value = [
        "Damage to furniture including sofas is covered up to the sum insured."
    ]
    _mock_download(mock_graph_traced_client)
    _mock_notify(mock_notify_traced_client)

    claim_id = str(uuid.uuid4())
    policy_id = str(uuid.uuid4())
    item_id = str(uuid.uuid4())

    client = _client()
    response = client.post(
        f"/v1/agent/claims/{claim_id}/start",
        json=_start_body(claim_id, policy_id, [item_id], [str(uuid.uuid4())]),
        headers=_internal_headers(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["waitReason"] is None

    state = client.get(f"/v1/agent/claims/{claim_id}/state", headers=_internal_headers())
    assert state.status_code == 200
    assert state.json()["dossier"] is not None
    assert state.json()["missingEvidence"] == []


@patch("agent_service.routes.agent.traced_client")
@patch("agent_service.indexing.extract_pages")
@patch("agent_service.workflow.graph.traced_client")
def test_run_waits_then_resumes_when_evidence_is_missing(
    mock_graph_traced_client: AsyncMock,
    mock_extract_pages: AsyncMock,
    mock_notify_traced_client: AsyncMock,
) -> None:
    mock_extract_pages.return_value = [
        "Damage to furniture including sofas is covered up to the sum insured."
    ]
    _mock_download(mock_graph_traced_client)
    _mock_notify(mock_notify_traced_client)

    claim_id = str(uuid.uuid4())
    policy_id = str(uuid.uuid4())
    item_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

    client = _client()
    # Two items, zero evidence documents — the missing-evidence heuristic
    # (fewer evidence docs than items) must pause the run.
    start = client.post(
        f"/v1/agent/claims/{claim_id}/start",
        json=_start_body(claim_id, policy_id, item_ids, []),
        headers=_internal_headers(),
    )
    assert start.status_code == 200
    assert start.json()["status"] == "waiting"
    assert start.json()["waitReason"] == "missing_documents"

    state = client.get(f"/v1/agent/claims/{claim_id}/state", headers=_internal_headers())
    assert state.json()["missingEvidence"] == item_ids
    # The dossier is still produced even while waiting (plan §18 P5-T7/T8).
    assert state.json()["dossier"] is not None

    resume = client.post(
        f"/v1/agent/claims/{claim_id}/resume",
        json={"evidenceDocumentIds": [str(uuid.uuid4()), str(uuid.uuid4())]},
        headers=_internal_headers(),
    )
    assert resume.status_code == 200
    assert resume.json()["status"] == "completed"

    final_state = client.get(f"/v1/agent/claims/{claim_id}/state", headers=_internal_headers())
    assert final_state.json()["missingEvidence"] == []


def test_resume_rejects_a_run_that_is_not_waiting() -> None:
    client = _client()
    response = client.post(
        f"/v1/agent/claims/{uuid.uuid4()}/resume",
        json={},
        headers=_internal_headers(),
    )
    assert response.status_code == 404


def test_rejects_a_call_without_valid_internal_auth() -> None:
    client = _client()
    response = client.post(
        f"/v1/agent/claims/{uuid.uuid4()}/start",
        json=_start_body(str(uuid.uuid4()), str(uuid.uuid4()), [str(uuid.uuid4())], []),
    )
    assert response.status_code == 403


def _mock_download(mock_traced_client: AsyncMock) -> None:
    mock_client = AsyncMock()

    async def _get(url: str, **_kwargs: object) -> AsyncMock:
        response = AsyncMock()
        if url.endswith("/download-url"):
            response.status_code = 200
            response.json = lambda: {"downloadUrl": "http://evidence-service.invalid/fake.pdf"}
        else:
            response.status_code = 200
            response.content = b"%PDF-fake-bytes-not-actually-parsed%"
        return response

    mock_client.get = AsyncMock(side_effect=_get)
    mock_traced_client.return_value.__aenter__.return_value = mock_client


def _mock_notify(mock_traced_client: AsyncMock) -> None:
    mock_client = AsyncMock()
    mock_traced_client.return_value.__aenter__.return_value = mock_client
