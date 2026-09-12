"""Claim workflow (plan §18 P5-T6/T7/T8).

A hand-rolled, resumable node sequence rather than the LangGraph *library*
itself — resuming needs precise node-level control, and the plan explicitly
allows "persist a JSON checkpoint table explicitly" as the equally-valid
fallback when a graph library's own checkpointer doesn't fit cleanly
(`agent_runs.state JSONB` is that checkpoint). The node shape and ordering
match the plan's LangGraph design exactly:

    load_claim -> ensure_verified -> ensure_policy_indexed ->
    parse_policy_coverage -> build_claim_dossier -> identify_missing_evidence
    -> [request_user_documents -> WAIT] | [continue]

Nodes beyond this (mandate capture, insurer submission, negotiation loop)
are Phase 6/7 and are not stubbed here.
"""

import uuid
from dataclasses import dataclass
from typing import Any

from recoveryai_common.observability import traced_client
from recoveryai_common.runtime import AppError
from sqlalchemy.ext.asyncio import AsyncSession

from agent_service.coverage_extraction import ClaimItemInput, extract_coverage_for_item
from agent_service.dossier import build_dossier
from agent_service.entitlement import EntitlementBand, compute_entitlement_band
from agent_service.indexing import index_policy
from agent_service.internal_auth import (
    HEADER_SERVICE,
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    sign_internal_service_request,
)
from agent_service.models.coverage import CoverageFinding
from agent_service.providers.base import EmbeddingProvider, LLMProvider
from agent_service.providers.ocr import MockOcrProvider

WORKFLOW_NAME = "claim_agent"
WORKFLOW_VERSION = "2026-09-v1"

NODE_SEQUENCE = [
    "load_claim",
    "ensure_verified",
    "ensure_policy_indexed",
    "parse_policy_coverage",
    "build_claim_dossier",
    "identify_missing_evidence",
]


@dataclass
class WorkflowDeps:
    session: AsyncSession
    embedding_provider: EmbeddingProvider
    llm_provider: LLMProvider
    ocr_provider: MockOcrProvider
    evidence_service_url: str
    internal_service_secret: str
    service_name: str = "agent-service"


async def _load_claim(_deps: WorkflowDeps, state: dict[str, Any]) -> dict[str, Any]:
    snapshot = state["claimSnapshot"]
    if not snapshot.get("items"):
        raise AppError("CLAIM_HAS_NO_ITEMS", "Claim snapshot has no items to process", 422)
    return state


async def _ensure_verified(_deps: WorkflowDeps, state: dict[str, Any]) -> dict[str, Any]:
    decision = state["claimSnapshot"].get("verificationDecision")
    if decision != "pass":
        raise AppError(
            "CLAIM_NOT_VERIFIED",
            "Agent workflow requires a claim that passed verification",
            422,
        )
    return state


async def _download_policy_bytes(deps: WorkflowDeps, document_id: str) -> bytes:
    token = sign_internal_service_request(deps.internal_service_secret, deps.service_name)
    async with traced_client(timeout=15.0) as client:
        url_response = await client.get(
            f"{deps.evidence_service_url}/v1/documents/{document_id}/download-url",
            headers={
                HEADER_SERVICE: token.service,
                HEADER_TIMESTAMP: token.timestamp,
                HEADER_SIGNATURE: token.signature,
            },
        )
        if url_response.status_code != 200:
            raise AppError(
                "POLICY_DOCUMENT_UNAVAILABLE",
                "Could not obtain a download URL for the policy document",
                502,
            )
        download_url = url_response.json()["downloadUrl"]

        pdf_response = await client.get(download_url)
        if pdf_response.status_code != 200:
            raise AppError(
                "POLICY_DOCUMENT_UNAVAILABLE",
                "Could not download the policy document",
                502,
            )
        return pdf_response.content


async def _ensure_policy_indexed(deps: WorkflowDeps, state: dict[str, Any]) -> dict[str, Any]:
    snapshot = state["claimSnapshot"]
    policy_id = uuid.UUID(snapshot["policyId"])
    document_id = uuid.UUID(snapshot["policyEvidenceDocumentId"])

    pdf_bytes = await _download_policy_bytes(deps, str(document_id))
    chunk_count = await index_policy(
        deps.session,
        policy_id=policy_id,
        document_id=document_id,
        pdf_bytes=pdf_bytes,
        embedding_provider=deps.embedding_provider,
        ocr_provider=deps.ocr_provider,
    )
    state["policyIndexed"] = True
    state["policyChunkCount"] = chunk_count
    return state


async def _parse_policy_coverage(deps: WorkflowDeps, state: dict[str, Any]) -> dict[str, Any]:
    snapshot = state["claimSnapshot"]
    policy_id = uuid.UUID(snapshot["policyId"])

    findings: list[CoverageFinding] = []
    claimed_values: dict[uuid.UUID, int] = {}
    for raw_item in snapshot["items"]:
        item = ClaimItemInput(
            id=uuid.UUID(raw_item["id"]),
            description=raw_item["description"],
            category=raw_item["category"],
            claimed_value_paise=int(raw_item["claimedValuePaise"]),
        )
        claimed_values[item.id] = item.claimed_value_paise
        finding = await extract_coverage_for_item(
            deps.session,
            policy_id=policy_id,
            item=item,
            embedding_provider=deps.embedding_provider,
            llm_provider=deps.llm_provider,
        )
        findings.append(finding)

    entitlement_band = compute_entitlement_band(claimed_values, findings)
    state["coverageFindings"] = [f.model_dump(mode="json") for f in findings]
    state["entitlementBand"] = entitlement_band.model_dump(mode="json")
    return state


async def _build_claim_dossier(_deps: WorkflowDeps, state: dict[str, Any]) -> dict[str, Any]:
    findings = [CoverageFinding.model_validate(f) for f in state["coverageFindings"]]
    band = EntitlementBand.model_validate(state["entitlementBand"])
    state["dossier"] = build_dossier(
        claim_snapshot=state["claimSnapshot"],
        coverage_findings=findings,
        entitlement_band=band,
    )
    return state


async def _identify_missing_evidence(_deps: WorkflowDeps, state: dict[str, Any]) -> dict[str, Any]:
    """Best-effort completeness heuristic: each claim item is expected to
    have at least one supporting evidence document. This does not track
    which document supports which item (evidence links are per-claim, not
    per-item, in claims-service's current schema) — it only checks the
    aggregate count, which is enough to demonstrate the wait/resume path
    without inventing a per-item evidence schema this phase doesn't need.
    """
    snapshot = state["claimSnapshot"]
    items = snapshot["items"]
    evidence_count = len(snapshot.get("evidenceDocumentIds", []))
    missing = [item["id"] for item in items[evidence_count:]] if evidence_count < len(items) else []
    state["missingEvidence"] = missing
    return state


_NODE_FUNCS = {
    "load_claim": _load_claim,
    "ensure_verified": _ensure_verified,
    "ensure_policy_indexed": _ensure_policy_indexed,
    "parse_policy_coverage": _parse_policy_coverage,
    "build_claim_dossier": _build_claim_dossier,
    "identify_missing_evidence": _identify_missing_evidence,
}


async def run_from(
    deps: WorkflowDeps, state: dict[str, Any], start_index: int = 0
) -> dict[str, Any]:
    for node_name in NODE_SEQUENCE[start_index:]:
        state = await _NODE_FUNCS[node_name](deps, state)
        if node_name == "identify_missing_evidence" and state["missingEvidence"]:
            state["status"] = "waiting"
            state["currentNode"] = "request_user_documents"
            state["waitReason"] = "missing_documents"
            return state

    state["status"] = "completed"
    state["currentNode"] = None
    state["waitReason"] = None
    return state


def resume_index() -> int:
    """Index to resume from: rebuild the dossier against the updated
    snapshot (its `evidenceDocumentIds` must reflect the new evidence) and
    re-check missing evidence, then complete. Indexing and coverage
    extraction are not redone — nothing about the policy or its coverage
    findings changed, only which evidence documents are now linked."""
    return NODE_SEQUENCE.index("build_claim_dossier")
