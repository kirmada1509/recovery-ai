"""Deterministic entitlement calculator (plan §18 P5-T5).

Pure, no I/O — "strategy is code" (CLAUDE.md invariant 3) applies here as
much as to negotiation: which entitlement band an item gets is a function
of its coverage finding, never an LLM judgment call. All arithmetic is on
integer paise (CLAUDE.md invariant 1); nothing here ever produces or
consumes a float.
"""

from uuid import UUID

from pydantic import BaseModel

from agent_service.models.coverage import CoverageFinding

# Versioned, documented widening rule (not tunable magic): a fully-confident
# "covered" finding collapses low/high onto the point estimate; anything
# less certain widens the low end proportionally to (1 - confidence).
ENTITLEMENT_RULESET_VERSION = "2026-09-v1"
FULL_CONFIDENCE_THRESHOLD = 0.9


class ItemEntitlement(BaseModel):
    item_id: UUID
    eligible_value_paise: int
    deductible_paise: int
    depreciation_paise: int
    entitlement_low_paise: int
    entitlement_point_paise: int
    entitlement_high_paise: int


class EntitlementBand(BaseModel):
    low_paise: int
    point_paise: int
    high_paise: int
    items: list[ItemEntitlement]


def _eligible_value_paise(claimed_value_paise: int, finding: CoverageFinding) -> int:
    if finding.coverage == "excluded":
        return 0
    if finding.coverage == "uncertain":
        return 0
    # "covered" and "partial" both start from the claimed value; a partial
    # finding's uncertainty is expressed via the low/high band, not by
    # zeroing the eligible value outright.
    if finding.max_payable_paise is not None:
        return min(claimed_value_paise, finding.max_payable_paise)
    return claimed_value_paise


def compute_item_entitlement(claimed_value_paise: int, finding: CoverageFinding) -> ItemEntitlement:
    eligible = _eligible_value_paise(claimed_value_paise, finding)
    deductible = finding.deductible_paise or 0
    depreciation = finding.depreciation_paise or 0

    point = max(eligible - deductible - depreciation, 0)

    if finding.coverage == "covered" and finding.confidence >= FULL_CONFIDENCE_THRESHOLD:
        low = point
        high = point
    else:
        low = int(point * finding.confidence)
        high = point

    return ItemEntitlement(
        item_id=finding.item_id,
        eligible_value_paise=eligible,
        deductible_paise=deductible,
        depreciation_paise=depreciation,
        entitlement_low_paise=low,
        entitlement_point_paise=point,
        entitlement_high_paise=high,
    )


def compute_entitlement_band(
    claimed_values_paise: dict[UUID, int], findings: list[CoverageFinding]
) -> EntitlementBand:
    items = [
        compute_item_entitlement(claimed_values_paise[finding.item_id], finding)
        for finding in findings
    ]
    return EntitlementBand(
        low_paise=sum(item.entitlement_low_paise for item in items),
        point_paise=sum(item.entitlement_point_paise for item in items),
        high_paise=sum(item.entitlement_high_paise for item in items),
        items=items,
    )
