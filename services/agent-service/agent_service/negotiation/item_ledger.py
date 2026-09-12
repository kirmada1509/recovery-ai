"""Negotiation item ledger shape (plan §6.7 `negotiation_item_ledger` / §18
P5-T9) — pure, in-memory objects only. No table exists yet; nothing
populates this from a real insurer offer until Phase 7.
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from agent_service.entitlement import EntitlementBand

Disposition = Literal["pending", "accepted", "disputed", "withdrawn"]


class LedgerItem(BaseModel):
    item_id: UUID
    claimed_paise: int
    entitlement_paise: int
    insurer_allowed_paise: int | None = None
    gap_paise: int | None = None
    disposition: Disposition = "pending"


def build_item_ledger(
    *,
    claimed_values_paise: dict[UUID, int],
    entitlement_band: EntitlementBand,
    insurer_allowed_paise: dict[UUID, int] | None = None,
) -> list[LedgerItem]:
    allowed = insurer_allowed_paise or {}
    ledger: list[LedgerItem] = []
    for item in entitlement_band.items:
        allowed_amount = allowed.get(item.item_id)
        claimed_amount = claimed_values_paise[item.item_id]
        ledger.append(
            LedgerItem(
                item_id=item.item_id,
                claimed_paise=claimed_amount,
                entitlement_paise=item.entitlement_point_paise,
                insurer_allowed_paise=allowed_amount,
                gap_paise=(claimed_amount - allowed_amount) if allowed_amount is not None else None,
                disposition="pending",
            )
        )
    return ledger
