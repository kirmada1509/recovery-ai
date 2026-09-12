"""Property tests for the negotiation item ledger shape (plan §18 P5-T9)."""

import uuid

from agent_service.entitlement import EntitlementBand, ItemEntitlement
from agent_service.negotiation.item_ledger import build_item_ledger


def _band(items: list[ItemEntitlement]) -> EntitlementBand:
    return EntitlementBand(
        low_paise=sum(i.entitlement_low_paise for i in items),
        point_paise=sum(i.entitlement_point_paise for i in items),
        high_paise=sum(i.entitlement_high_paise for i in items),
        items=items,
    )


def test_gap_paise_equals_claimed_minus_allowed_when_present() -> None:
    item_id = uuid.uuid4()
    band = _band(
        [
            ItemEntitlement(
                item_id=item_id,
                eligible_value_paise=500_00,
                deductible_paise=0,
                depreciation_paise=0,
                entitlement_low_paise=400_00,
                entitlement_point_paise=500_00,
                entitlement_high_paise=500_00,
            )
        ]
    )
    ledger = build_item_ledger(
        claimed_values_paise={item_id: 500_00},
        entitlement_band=band,
        insurer_allowed_paise={item_id: 300_00},
    )
    assert ledger[0].gap_paise == 200_00


def test_gap_paise_is_none_when_no_offer_yet() -> None:
    item_id = uuid.uuid4()
    band = _band(
        [
            ItemEntitlement(
                item_id=item_id,
                eligible_value_paise=500_00,
                deductible_paise=0,
                depreciation_paise=0,
                entitlement_low_paise=400_00,
                entitlement_point_paise=500_00,
                entitlement_high_paise=500_00,
            )
        ]
    )
    ledger = build_item_ledger(claimed_values_paise={item_id: 500_00}, entitlement_band=band)
    assert ledger[0].insurer_allowed_paise is None
    assert ledger[0].gap_paise is None
    assert ledger[0].disposition == "pending"


def test_ledger_entitlement_totals_reconcile_to_the_band() -> None:
    item_ids = [uuid.uuid4() for _ in range(3)]
    items = [
        ItemEntitlement(
            item_id=item_id,
            eligible_value_paise=100_00 * (i + 1),
            deductible_paise=0,
            depreciation_paise=0,
            entitlement_low_paise=80_00 * (i + 1),
            entitlement_point_paise=100_00 * (i + 1),
            entitlement_high_paise=100_00 * (i + 1),
        )
        for i, item_id in enumerate(item_ids)
    ]
    band = _band(items)
    claimed_values = {item_id: 100_00 * (i + 1) for i, item_id in enumerate(item_ids)}

    ledger = build_item_ledger(claimed_values_paise=claimed_values, entitlement_band=band)

    assert sum(entry.entitlement_paise for entry in ledger) == band.point_paise
