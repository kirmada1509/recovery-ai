"""`/v1/verifications` routes (plan Section 7.5).

Internal-only: the request carries a normalized claim snapshot plus evidence
references, never a claims-service database read (CLAUDE.md invariant 2).
"""

import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from recoveryai_common.observability import get_logger, traced_client
from recoveryai_common.runtime import AppError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from verification_service.db.models import VerificationRun, VerificationSignal
from verification_service.internal_auth import (
    HEADER_SERVICE,
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    sign_internal_service_request,
    verify_internal_service_request,
)
from verification_service.providers.mock import (
    MockDisasterProvider,
    MockImageAnalysisProvider,
)
from verification_service.scoring.engine import run_verification
from verification_service.settings import VerificationServiceSettings


class VerificationRequest(BaseModel):
    """JSON is camelCase (plan Section 4 conventions); attributes stay
    snake_case for Python/ruff, matched via `Field(alias=...)`."""

    model_config = ConfigDict(populate_by_name=True)

    claim_id: str = Field(alias="claimId")
    incident_type: str = Field(default="other", alias="incidentType")
    incident_at: str | None = Field(default=None, alias="incidentAt")
    location: dict[str, object] = Field(default_factory=dict)
    claimed_amount_paise: int | None = Field(default=None, alias="claimedAmountPaise")
    items: list[dict[str, object]] = Field(default_factory=list)
    evidence_document_ids: list[str] = Field(default_factory=list, alias="evidenceDocumentIds")


def _require_internal_service(
    settings: VerificationServiceSettings,
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


def register_verification_routes(
    app: FastAPI,
    settings: VerificationServiceSettings,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    router = APIRouter()
    logger = get_logger(settings.service_name)
    disaster_provider = MockDisasterProvider()
    image_analysis_provider = MockImageAnalysisProvider()

    @router.post("/v1/verifications")
    async def create_verification(
        body: VerificationRequest,
        x_internal_service: Annotated[str | None, Header()] = None,
        x_internal_timestamp: Annotated[str | None, Header()] = None,
        x_internal_signature: Annotated[str | None, Header()] = None,
    ) -> dict[str, object]:
        _require_internal_service(
            settings, x_internal_service, x_internal_timestamp, x_internal_signature
        )

        result = await run_verification(
            body.model_dump(by_alias=True),
            disaster_provider=disaster_provider,
            image_analysis_provider=image_analysis_provider,
        )

        async with session_factory() as session, session.begin():
            run = VerificationRun(
                claim_id=uuid.UUID(body.claim_id),
                status="completed",
                overall_score=result.overall_score,
                decision=result.decision,
                reasons=result.reasons,
                ruleset_version=result.ruleset_version,
            )
            session.add(run)
            await session.flush()
            for signal in result.signals:
                session.add(
                    VerificationSignal(
                        run_id=run.id,
                        signal_type=signal.signal_type,
                        provider=signal.provider,
                        score=signal.score,
                        weight=signal.weight,
                        result=signal.result,
                        evidence_refs=signal.evidence_refs,
                    )
                )
            run_id = run.id

        # Callback to claims-service (plan Section 18 P4-T5) — best-effort;
        # claims-service's own callback handler is idempotent, so a retry
        # (e.g. from a future outbox on this side) is always safe.
        try:
            token = sign_internal_service_request(
                settings.internal_service_secret, settings.service_name
            )
            async with traced_client(timeout=10.0) as client:
                await client.post(
                    f"{settings.claims_service_url}/v1/internal/claims/{body.claim_id}/verification-result",
                    json={
                        "verificationRunId": str(run_id),
                        "decision": result.decision,
                        "overallScore": result.overall_score,
                        "reasons": result.reasons,
                    },
                    headers={
                        HEADER_SERVICE: token.service,
                        HEADER_TIMESTAMP: token.timestamp,
                        HEADER_SIGNATURE: token.signature,
                    },
                )
        except Exception as exc:
            logger.warning(
                "verification callback to claims-service failed",
                err=str(exc),
                claim_id=body.claim_id,
            )

        return {
            "verificationRunId": str(run_id),
            "decision": result.decision,
            "overallScore": result.overall_score,
            "signals": [
                {"type": s.signal_type, "score": s.score, "weight": s.weight, "reason": s.result}
                for s in result.signals
            ],
            "reasons": result.reasons,
            "requiresHumanReview": result.decision == "review",
        }

    @router.get("/v1/verifications/{run_id}")
    async def get_verification(
        run_id: str,
        x_internal_service: Annotated[str | None, Header()] = None,
        x_internal_timestamp: Annotated[str | None, Header()] = None,
        x_internal_signature: Annotated[str | None, Header()] = None,
    ) -> dict[str, object]:
        _require_internal_service(
            settings, x_internal_service, x_internal_timestamp, x_internal_signature
        )
        async with session_factory() as session:
            run = await session.get(VerificationRun, uuid.UUID(run_id))
            if not run:
                raise HTTPException(status_code=404, detail="Verification run not found")
            signals = (
                (
                    await session.execute(
                        select(VerificationSignal).where(VerificationSignal.run_id == run.id)
                    )
                )
                .scalars()
                .all()
            )
            return _serialize_run(run, signals)

    @router.get("/v1/claims/{claim_id}/latest-verification")
    async def get_latest_verification(
        claim_id: str,
        x_internal_service: Annotated[str | None, Header()] = None,
        x_internal_timestamp: Annotated[str | None, Header()] = None,
        x_internal_signature: Annotated[str | None, Header()] = None,
    ) -> dict[str, object]:
        _require_internal_service(
            settings, x_internal_service, x_internal_timestamp, x_internal_signature
        )
        async with session_factory() as session:
            run = (
                (
                    await session.execute(
                        select(VerificationRun)
                        .where(VerificationRun.claim_id == uuid.UUID(claim_id))
                        .order_by(VerificationRun.created_at.desc())
                        .limit(1)
                    )
                )
                .scalars()
                .first()
            )
            if not run:
                return {"run": None}
            signals = (
                (
                    await session.execute(
                        select(VerificationSignal).where(VerificationSignal.run_id == run.id)
                    )
                )
                .scalars()
                .all()
            )
            return {"run": _serialize_run(run, signals)}

    app.include_router(router)


def _serialize_run(
    run: VerificationRun, signals: Sequence[VerificationSignal]
) -> dict[str, object]:
    return {
        "id": str(run.id),
        "claimId": str(run.claim_id),
        "status": run.status,
        "overallScore": float(run.overall_score) if run.overall_score is not None else None,
        "decision": run.decision,
        "reasons": run.reasons,
        "rulesetVersion": run.ruleset_version,
        "signals": [
            {
                "type": s.signal_type,
                "provider": s.provider,
                "score": float(s.score),
                "weight": float(s.weight),
                "result": s.result,
                "evidenceRefs": s.evidence_refs,
            }
            for s in signals
        ],
    }
