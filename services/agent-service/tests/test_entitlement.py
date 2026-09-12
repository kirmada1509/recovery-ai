"""Entitlement band monotonicity, integer-only arithmetic, reconciliation
(plan §18 P5-T5) — property-based via hypothesis."""

import uuid

from agent_service.entitlement import (
    compute_entitlement_band,
    compute_item_entitlement,
)
from agent_service.models.coverage import CoverageFinding
from hypothesis import given
from hypothesis import strategies as st

_COVERAGES = ["covered", "excluded", "partial", "uncertain"]


@st.composite
def _finding_and_claimed_value(draw: st.DrawFn) -> tuple[CoverageFinding, int]:
    claimed_value_paise = draw(st.integers(min_value=0, max_value=10_000_000_00))
    coverage = draw(st.sampled_from(_COVERAGES))
    confidence = draw(st.floats(min_value=0.0, max_value=1.0, allow_nan=False))
    deductible = draw(st.integers(min_value=0, max_value=claimed_value_paise))
    depreciation = draw(st.integers(min_value=0, max_value=claimed_value_paise))
    max_payable = claimed_value_paise if coverage in ("covered", "partial") else None

    finding = CoverageFinding(
        item_id=uuid.uuid4(),
        coverage=coverage,  # type: ignore[arg-type]
        max_payable_paise=max_payable,
        deductible_paise=deductible,
        depreciation_paise=depreciation,
        confidence=confidence,
        rationale="generated",
        citations=[],
    )
    return finding, claimed_value_paise


@given(_finding_and_claimed_value())
def test_low_le_point_le_high(pair: tuple[CoverageFinding, int]) -> None:
    finding, claimed_value = pair
    item = compute_item_entitlement(claimed_value, finding)
    assert item.entitlement_low_paise <= item.entitlement_point_paise
    assert item.entitlement_point_paise <= item.entitlement_high_paise


@given(_finding_and_claimed_value())
def test_all_amounts_are_non_negative_integers(pair: tuple[CoverageFinding, int]) -> None:
    finding, claimed_value = pair
    item = compute_item_entitlement(claimed_value, finding)
    for value in (
        item.entitlement_low_paise,
        item.entitlement_point_paise,
        item.entitlement_high_paise,
    ):
        assert isinstance(value, int)
        assert value >= 0


@given(st.lists(_finding_and_claimed_value(), min_size=1, max_size=8))
def test_band_totals_reconcile_to_the_sum_of_item_entitlements(
    pairs: list[tuple[CoverageFinding, int]],
) -> None:
    findings = [pair[0] for pair in pairs]
    claimed_values = {pair[0].item_id: pair[1] for pair in pairs}
    band = compute_entitlement_band(claimed_values, findings)

    assert band.low_paise == sum(item.entitlement_low_paise for item in band.items)
    assert band.point_paise == sum(item.entitlement_point_paise for item in band.items)
    assert band.high_paise == sum(item.entitlement_high_paise for item in band.items)


def test_excluded_item_has_zero_entitlement() -> None:
    finding = CoverageFinding(
        item_id=uuid.uuid4(),
        coverage="excluded",
        max_payable_paise=0,
        deductible_paise=0,
        depreciation_paise=0,
        confidence=0.9,
        rationale="excluded by policy clause",
        citations=[],
    )
    item = compute_item_entitlement(500_000, finding)
    assert item.entitlement_low_paise == 0
    assert item.entitlement_point_paise == 0
    assert item.entitlement_high_paise == 0


def test_fully_confident_covered_item_collapses_the_band() -> None:
    finding = CoverageFinding(
        item_id=uuid.uuid4(),
        coverage="covered",
        max_payable_paise=500_000,
        deductible_paise=0,
        depreciation_paise=0,
        confidence=0.95,
        rationale="clearly covered",
        citations=[],
    )
    item = compute_item_entitlement(500_000, finding)
    assert item.entitlement_low_paise == item.entitlement_point_paise == item.entitlement_high_paise
