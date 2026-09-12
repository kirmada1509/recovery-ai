"""Weighted verification scoring (plan Section 8.4).

Deterministic and pure given its provider results — this is
verification-service's equivalent of "strategy is code": which decision a
claim gets is a function of explicit weights and thresholds, versioned via
`RULESET_VERSION`, never an LLM judgment call.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from verification_service.providers.base import DisasterProvider, ImageAnalysisProvider

RULESET_VERSION = "2026-09-v1"

WEIGHT_DISASTER_OCCURRENCE = 0.40
WEIGHT_EVIDENCE_PLAUSIBILITY = 0.30
WEIGHT_LOCATION_CONSISTENCY = 0.15
WEIGHT_COMPLETENESS = 0.15

PASS_THRESHOLD = 0.80
REVIEW_THRESHOLD = 0.55

# A disaster provider confidently reporting *no* event at all is the
# "mandatory contradiction" plan Section 8.4 describes — it overrides the
# weighted total even when every other signal is strong. Below this
# confidence, an absence is treated as uncertainty, not contradiction, and
# only affects the weighted score.
MANDATORY_CONTRADICTION_CONFIDENCE = 0.7

Decision = Literal["pass", "fail", "review"]


@dataclass(frozen=True)
class SignalResult:
    signal_type: str
    provider: str
    score: float
    weight: float
    result: dict[str, object]
    evidence_refs: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class VerificationResult:
    decision: Decision
    overall_score: float
    signals: list[SignalResult]
    reasons: list[str]
    ruleset_version: str = RULESET_VERSION


def _as_float(value: object) -> float | None:
    return value if isinstance(value, int | float) else None


def _completeness_score(snapshot: dict[str, object]) -> tuple[float, list[str]]:
    """Explicit, auditable rules (plan Section 8.3) — not ad-hoc if/else.

    Each of these is already required by claims-service's own submit
    validation, so this will normally be 1.0; it is recomputed here rather
    than trusted, since verification-service must not assume another
    service's internal invariants hold.
    """
    location = snapshot.get("location")
    has_city = bool(location.get("city")) if isinstance(location, dict) else False
    checks: list[tuple[str, bool]] = [
        ("has at least one claim item", bool(snapshot.get("items"))),
        ("has incident location", has_city),
        ("has incident date", bool(snapshot.get("incidentAt"))),
        ("has linked evidence", bool(snapshot.get("evidenceDocumentIds"))),
    ]
    passed = [name for name, ok in checks if ok]
    missing = [name for name, ok in checks if not ok]
    score = len(passed) / len(checks) if checks else 0.0
    reasons = [f"missing: {name}" for name in missing]
    return score, reasons


async def run_verification(
    snapshot: dict[str, object],
    *,
    disaster_provider: DisasterProvider,
    image_analysis_provider: ImageAnalysisProvider,
) -> VerificationResult:
    incident_type = str(snapshot.get("incidentType", "other"))
    incident_at_raw = snapshot.get("incidentAt")
    incident_at = datetime.fromisoformat(str(incident_at_raw)) if incident_at_raw else None
    location_raw = snapshot.get("location")
    location: dict[str, object] = location_raw if isinstance(location_raw, dict) else {}
    city = str(location.get("city")) if location.get("city") else None
    evidence_ids_raw = snapshot.get("evidenceDocumentIds")
    evidence_ids: list[str] = list(evidence_ids_raw) if isinstance(evidence_ids_raw, list) else []

    disaster_signal = await disaster_provider.check(
        incident_type=incident_type,
        occurred_at=incident_at,
        latitude=_as_float(location.get("latitude")),
        longitude=_as_float(location.get("longitude")),
        location_hint=city,
    )
    disaster_score = (
        disaster_signal.confidence if disaster_signal.occurred else (1 - disaster_signal.confidence)
    )

    image_result = None
    if evidence_ids:
        image_result = await image_analysis_provider.analyze(evidence_ids[0], incident_type)
    evidence_score = image_result.confidence if image_result else 0.0

    # No real geocoding exists yet (plan Section 8.2's metadata/location
    # signal degrades gracefully rather than penalizing a claim for a gap in
    # the mock — absence of EXIF/GPS must never itself fail a claim).
    location_score = 0.8

    completeness_score, completeness_reasons = _completeness_score(snapshot)

    overall_score = round(
        disaster_score * WEIGHT_DISASTER_OCCURRENCE
        + evidence_score * WEIGHT_EVIDENCE_PLAUSIBILITY
        + location_score * WEIGHT_LOCATION_CONSISTENCY
        + completeness_score * WEIGHT_COMPLETENESS,
        4,
    )

    mandatory_contradiction = (
        not disaster_signal.occurred
        and disaster_signal.confidence >= MANDATORY_CONTRADICTION_CONFIDENCE
    )

    reasons: list[str] = [disaster_signal.reason, *completeness_reasons]

    if mandatory_contradiction:
        decision: Decision = "fail"
        reasons.append(
            "mandatory contradiction: disaster provider confidently found no matching event"
        )
    elif overall_score >= PASS_THRESHOLD:
        decision = "pass"
    elif overall_score >= REVIEW_THRESHOLD:
        decision = "review"
    else:
        decision = "fail"

    signals = [
        SignalResult(
            signal_type="disaster_occurrence",
            provider="mock",
            score=disaster_score,
            weight=WEIGHT_DISASTER_OCCURRENCE,
            result={
                "occurred": disaster_signal.occurred,
                "confidence": disaster_signal.confidence,
                "eventName": disaster_signal.event_name,
                "reason": disaster_signal.reason,
            },
        ),
        SignalResult(
            signal_type="evidence_plausibility",
            provider="mock",
            score=evidence_score,
            weight=WEIGHT_EVIDENCE_PLAUSIBILITY,
            result={
                "labels": image_result.labels if image_result else [],
                "hasEvidence": bool(image_result),
            },
            evidence_refs=evidence_ids,
        ),
        SignalResult(
            signal_type="location_consistency",
            provider="mock",
            score=location_score,
            weight=WEIGHT_LOCATION_CONSISTENCY,
            result={"note": "no geocoding provider wired yet; neutral-positive default"},
        ),
        SignalResult(
            signal_type="completeness",
            provider="internal",
            score=completeness_score,
            weight=WEIGHT_COMPLETENESS,
            result={"missing": completeness_reasons},
        ),
    ]

    return VerificationResult(
        decision=decision,
        overall_score=overall_score,
        signals=signals,
        reasons=reasons,
    )
