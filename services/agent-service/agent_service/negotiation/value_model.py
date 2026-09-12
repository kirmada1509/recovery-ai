"""Negotiation value model (plan §10.3 / §18 P5-T9) — pure functions only.

Not wired to anything yet: Phase 7 builds the real negotiation loop against
`negotiation_sessions`. This exists now so the reservation/opening-ask
arithmetic is a versioned, tested function from day one, matching CLAUDE.md
invariant 3 ("strategy is code") and invariant 4 ("never settle below the
reservation value") — those invariants apply to the *function*, which is
what this phase can actually deliver, before there is a real negotiation
loop to enforce them in.
"""

from pydantic import BaseModel

# The floor below entitlement-low the reservation value may fall to before
# a mandate's own minimum takes over — a documented, versioned constant.
RESERVATION_FLOOR_RATIO = 0.85


class NegotiationValueModel(BaseModel):
    claimed_paise: int
    sum_insured_paise: int
    entitlement_low_paise: int
    entitlement_high_paise: int
    opening_ask_paise: int
    reservation_paise: int
    target_paise: int


def build_value_model(
    *,
    claimed_paise: int,
    sum_insured_paise: int,
    entitlement_low_paise: int,
    entitlement_high_paise: int,
    mandate_min_paise: int,
) -> NegotiationValueModel:
    opening_ask_paise = min(claimed_paise, sum_insured_paise, entitlement_high_paise)
    reservation_paise = max(int(entitlement_low_paise * RESERVATION_FLOOR_RATIO), mandate_min_paise)
    # Reservation can never exceed the opening ask — a value model whose
    # floor is above its own ceiling would let a "correct" strategy engine
    # immediately violate invariant 4 the moment it opens.
    reservation_paise = min(reservation_paise, opening_ask_paise)
    target_paise = (opening_ask_paise + reservation_paise) // 2

    return NegotiationValueModel(
        claimed_paise=claimed_paise,
        sum_insured_paise=sum_insured_paise,
        entitlement_low_paise=entitlement_low_paise,
        entitlement_high_paise=entitlement_high_paise,
        opening_ask_paise=opening_ask_paise,
        reservation_paise=reservation_paise,
        target_paise=target_paise,
    )
