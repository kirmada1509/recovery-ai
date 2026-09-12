"""Scoring engine tests (plan §18 P4 gate): all three fixture decisions,
plus determinism and the mandatory-contradiction override."""

from verification_service.providers.mock import MockDisasterProvider, MockImageAnalysisProvider
from verification_service.scoring.engine import (
    PASS_THRESHOLD,
    REVIEW_THRESHOLD,
    run_verification,
)

DISASTER = MockDisasterProvider()
IMAGE = MockImageAnalysisProvider()


def _snapshot(city: str) -> dict[str, object]:
    return {
        "claimId": "11111111-1111-1111-1111-111111111111",
        "incidentType": "flood",
        "incidentAt": "2026-08-01T00:00:00+00:00",
        "location": {"city": city},
        "items": [{"description": "Sofa", "claimedValuePaise": 500000}],
        "evidenceDocumentIds": ["22222222-2222-2222-2222-222222222222"],
    }


async def test_confirmed_event_passes() -> None:
    result = await run_verification(
        _snapshot("Chennai"), disaster_provider=DISASTER, image_analysis_provider=IMAGE
    )
    assert result.decision == "pass"
    assert result.overall_score >= PASS_THRESHOLD


async def test_ambiguous_signal_goes_to_review() -> None:
    result = await run_verification(
        _snapshot("Ambiguous City"), disaster_provider=DISASTER, image_analysis_provider=IMAGE
    )
    assert result.decision == "review"
    assert REVIEW_THRESHOLD <= result.overall_score < PASS_THRESHOLD


async def test_confident_absence_fails_via_mandatory_override() -> None:
    result = await run_verification(
        _snapshot("Faketown"), disaster_provider=DISASTER, image_analysis_provider=IMAGE
    )
    assert result.decision == "fail"
    assert any("mandatory contradiction" in reason for reason in result.reasons)


async def test_unrecognized_location_is_cautious_not_confident() -> None:
    result = await run_verification(
        _snapshot("Nowhereville"), disaster_provider=DISASTER, image_analysis_provider=IMAGE
    )
    # Low confidence in an absence is uncertainty, not a mandatory
    # contradiction — it should influence the weighted score, not force fail.
    assert result.decision in {"review", "fail"}
    assert not any("mandatory contradiction" in reason for reason in result.reasons)


async def test_deterministic_same_input_same_output() -> None:
    a = await run_verification(
        _snapshot("Chennai"), disaster_provider=DISASTER, image_analysis_provider=IMAGE
    )
    b = await run_verification(
        _snapshot("Chennai"), disaster_provider=DISASTER, image_analysis_provider=IMAGE
    )
    assert a.decision == b.decision
    assert a.overall_score == b.overall_score
    assert a.ruleset_version == b.ruleset_version


async def test_missing_evidence_lowers_completeness_but_never_from_missing_exif() -> None:
    snapshot = _snapshot("Chennai")
    snapshot["evidenceDocumentIds"] = []
    result = await run_verification(
        snapshot, disaster_provider=DISASTER, image_analysis_provider=IMAGE
    )
    completeness = next(s for s in result.signals if s.signal_type == "completeness")
    assert completeness.score < 1.0
    assert any("missing: has linked evidence" in reason for reason in result.reasons)
