"""Claim dossier assembly (plan §18 P5-T7).

Built entirely from the claim snapshot claims-service already dispatched
and the coverage/entitlement work done earlier in the graph — never a live
call back to claims-service or verification-service (CLAUDE.md invariant 2:
no cross-service DB reads, and the snapshot already carries everything
needed).
"""

from typing import Any

from agent_service.entitlement import EntitlementBand
from agent_service.models.coverage import CoverageFinding


def build_dossier(
    *,
    claim_snapshot: dict[str, Any],
    coverage_findings: list[CoverageFinding],
    entitlement_band: EntitlementBand,
) -> dict[str, Any]:
    citations = [
        citation.model_dump(mode="json")
        for finding in coverage_findings
        for citation in finding.citations
    ]

    return {
        "claimId": claim_snapshot.get("claimId"),
        "userId": claim_snapshot.get("userId"),
        "incidentSummary": {
            "incidentType": claim_snapshot.get("incidentType"),
            "incidentAt": claim_snapshot.get("incidentAt"),
            "location": claim_snapshot.get("location"),
        },
        "items": claim_snapshot.get("items", []),
        "evidenceDocumentIds": claim_snapshot.get("evidenceDocumentIds", []),
        "verificationSummary": {
            "decision": claim_snapshot.get("verificationDecision"),
            "overallScore": claim_snapshot.get("verificationOverallScore"),
            "reasons": claim_snapshot.get("verificationReasons", []),
        },
        "coverageFindings": [finding.model_dump(mode="json") for finding in coverage_findings],
        "claimedAmountPaise": claim_snapshot.get("claimedAmountPaise"),
        "estimatedEntitlement": entitlement_band.model_dump(mode="json"),
        "policyCitations": citations,
    }
