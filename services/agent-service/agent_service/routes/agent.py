"""`/v1/agent/claims/*` routes (plan §18 P5-T6/T8).

Internal-only: claims-service dispatches a normalized claim snapshot, never
a database read into claims-service's own tables (CLAUDE.md invariant 2).
"""

import uuid
from typing import Annotated, Any, cast

from fastapi import APIRouter, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from recoveryai_common.observability import get_logger, traced_client
from recoveryai_common.runtime import AppError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm.attributes import flag_modified

from agent_service.db.models import AgentRun
from agent_service.internal_auth import (
    HEADER_SERVICE,
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    sign_internal_service_request,
    verify_internal_service_request,
)
from agent_service.providers.embeddings import MockEmbeddingProvider
from agent_service.providers.llm import MockLLMProvider
from agent_service.providers.ocr import MockOcrProvider
from agent_service.settings import AgentServiceSettings
from agent_service.workflow.graph import (
    WORKFLOW_NAME,
    WORKFLOW_VERSION,
    WorkflowDeps,
    resume_index,
    run_from,
)


class StartAgentRunRequest(BaseModel):
    """JSON is camelCase (plan conventions); attributes stay snake_case for
    Python/ruff, matched via `Field(alias=...)` (same convention as
    verification-service's `VerificationRequest`)."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    claim_id: str = Field(alias="claimId")
    user_id: str | None = Field(default=None, alias="userId")
    incident_type: str | None = Field(default=None, alias="incidentType")
    incident_at: str | None = Field(default=None, alias="incidentAt")
    location: dict[str, object] = Field(default_factory=dict)
    claimed_amount_paise: int | None = Field(default=None, alias="claimedAmountPaise")
    items: list[dict[str, object]] = Field(default_factory=list)
    evidence_document_ids: list[str] = Field(default_factory=list, alias="evidenceDocumentIds")
    policy_id: str = Field(alias="policyId")
    policy_evidence_document_id: str = Field(alias="policyEvidenceDocumentId")
    verification_decision: str | None = Field(default=None, alias="verificationDecision")
    verification_overall_score: float | None = Field(default=None, alias="verificationOverallScore")
    verification_reasons: list[str] = Field(default_factory=list, alias="verificationReasons")


class ResumeAgentRunRequest(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    evidence_document_ids: list[str] | None = Field(default=None, alias="evidenceDocumentIds")


def _require_internal_service(
    settings: AgentServiceSettings,
    x_internal_service: str | None,
    x_internal_timestamp: str | None,
    x_internal_signature: str | None,
) -> None:
    ok = verify_internal_service_request(
        x_internal_service,
        x_internal_timestamp,
        x_internal_signature,
        secret=settings.internal_service_secret,
        allowed_services=settings.internal_allowed_callers,
    )
    if not ok:
        raise AppError("FORBIDDEN", "Internal service authentication failed", 403)


def _build_deps(session: AsyncSession, settings: AgentServiceSettings) -> WorkflowDeps:
    return WorkflowDeps(
        session=session,
        embedding_provider=MockEmbeddingProvider(),
        llm_provider=MockLLMProvider(),
        ocr_provider=MockOcrProvider(),
        evidence_service_url=settings.evidence_service_url,
        internal_service_secret=settings.internal_service_secret,
    )


async def _notify_claims_service(
    settings: AgentServiceSettings, claim_id: str, run: AgentRun
) -> None:
    """Best-effort callback (mirrors verification-service's own pattern) —
    claims-service's handler is idempotent, so a retry is always safe."""
    logger = get_logger(settings.service_name)
    try:
        token = sign_internal_service_request(
            settings.internal_service_secret, settings.service_name
        )
        async with traced_client(timeout=10.0) as client:
            await client.post(
                f"{settings.claims_service_url}/v1/internal/claims/{claim_id}/agent-update",
                json={
                    "agentRunId": str(run.id),
                    "status": run.status,
                    "dossier": run.state.get("dossier"),
                },
                headers={
                    HEADER_SERVICE: token.service,
                    HEADER_TIMESTAMP: token.timestamp,
                    HEADER_SIGNATURE: token.signature,
                },
            )
    except Exception as exc:
        logger.warning(
            "agent-update callback to claims-service failed", err=str(exc), claim_id=claim_id
        )


def register_agent_routes(
    app: FastAPI,
    settings: AgentServiceSettings,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    router = APIRouter()

    @router.post("/v1/agent/claims/{claim_id}/start")
    async def start_run(
        claim_id: str,
        body: StartAgentRunRequest,
        x_internal_service: Annotated[str | None, Header()] = None,
        x_internal_timestamp: Annotated[str | None, Header()] = None,
        x_internal_signature: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        _require_internal_service(
            settings, x_internal_service, x_internal_timestamp, x_internal_signature
        )

        snapshot = body.model_dump(by_alias=True)
        async with session_factory() as session:
            run = AgentRun(
                claim_id=uuid.UUID(claim_id),
                workflow_name=WORKFLOW_NAME,
                workflow_version=WORKFLOW_VERSION,
                status="running",
                state={"claimSnapshot": snapshot},
            )
            session.add(run)
            await session.flush()

            deps = _build_deps(session, settings)
            state = await run_from(deps, run.state, start_index=0)
            run.status = state["status"]
            run.current_node = state["currentNode"]
            run.wait_reason = state["waitReason"]
            run.state = state
            # `state` is mutated in place by the workflow nodes and is the
            # very same object already attached as `run.state` — SQLAlchemy
            # only detects a JSONB column as dirty via object-identity/value
            # comparison against its committed snapshot, which an in-place
            # mutation never changes. `flag_modified` forces the column into
            # the UPDATE regardless (the well-known mutable-JSON pitfall;
            # the alternative, `MutableDict.as_mutable`, requires changing
            # the column type itself).
            flag_modified(run, "state")
            await session.commit()

        await _notify_claims_service(settings, claim_id, run)
        return {"runId": str(run.id), "status": run.status, "waitReason": run.wait_reason}

    @router.post("/v1/agent/claims/{claim_id}/resume")
    async def resume_run(
        claim_id: str,
        body: ResumeAgentRunRequest,
        x_internal_service: Annotated[str | None, Header()] = None,
        x_internal_timestamp: Annotated[str | None, Header()] = None,
        x_internal_signature: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        _require_internal_service(
            settings, x_internal_service, x_internal_timestamp, x_internal_signature
        )

        async with session_factory() as session:
            run = await _latest_run_for_claim(session, claim_id)
            if not run:
                raise HTTPException(status_code=404, detail="No agent run found for this claim")
            if run.status != "waiting":
                raise AppError("AGENT_RUN_NOT_WAITING", "Agent run is not awaiting resume", 409)

            if body.evidence_document_ids is not None:
                claim_snapshot = cast(dict[str, Any], run.state["claimSnapshot"])
                claim_snapshot["evidenceDocumentIds"] = body.evidence_document_ids

            deps = _build_deps(session, settings)
            state = await run_from(deps, run.state, start_index=resume_index())
            run.status = state["status"]
            run.current_node = state["currentNode"]
            run.wait_reason = state["waitReason"]
            run.state = state
            flag_modified(run, "state")
            await session.commit()

        await _notify_claims_service(settings, claim_id, run)
        return {"runId": str(run.id), "status": run.status, "waitReason": run.wait_reason}

    @router.get("/v1/agent/claims/{claim_id}/state")
    async def get_state(
        claim_id: str,
        x_internal_service: Annotated[str | None, Header()] = None,
        x_internal_timestamp: Annotated[str | None, Header()] = None,
        x_internal_signature: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        _require_internal_service(
            settings, x_internal_service, x_internal_timestamp, x_internal_signature
        )
        async with session_factory() as session:
            run = await _latest_run_for_claim(session, claim_id)
            if not run:
                raise HTTPException(status_code=404, detail="No agent run found for this claim")
            return {
                "runId": str(run.id),
                "status": run.status,
                "currentNode": run.current_node,
                "waitReason": run.wait_reason,
                "dossier": run.state.get("dossier"),
                "coverageFindings": run.state.get("coverageFindings"),
                "entitlementBand": run.state.get("entitlementBand"),
                "missingEvidence": run.state.get("missingEvidence"),
            }

    app.include_router(router)


async def _latest_run_for_claim(session: AsyncSession, claim_id: str) -> AgentRun | None:
    result = await session.execute(
        select(AgentRun)
        .where(AgentRun.claim_id == uuid.UUID(claim_id))
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()
