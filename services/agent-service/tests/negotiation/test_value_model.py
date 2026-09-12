"""Property tests for the negotiation value model (plan §18 P5-T9)."""

from agent_service.negotiation.value_model import build_value_model
from hypothesis import given
from hypothesis import strategies as st


@given(
    claimed_paise=st.integers(min_value=0, max_value=10_000_000_00),
    sum_insured_paise=st.integers(min_value=0, max_value=10_000_000_00),
    entitlement_low_paise=st.integers(min_value=0, max_value=10_000_000_00),
    entitlement_high_paise=st.integers(min_value=0, max_value=10_000_000_00),
    mandate_min_paise=st.integers(min_value=0, max_value=10_000_000_00),
)
def test_reservation_never_exceeds_opening_ask(
    claimed_paise: int,
    sum_insured_paise: int,
    entitlement_low_paise: int,
    entitlement_high_paise: int,
    mandate_min_paise: int,
) -> None:
    model = build_value_model(
        claimed_paise=claimed_paise,
        sum_insured_paise=sum_insured_paise,
        entitlement_low_paise=entitlement_low_paise,
        entitlement_high_paise=entitlement_high_paise,
        mandate_min_paise=mandate_min_paise,
    )
    assert model.reservation_paise <= model.opening_ask_paise


@given(
    claimed_paise=st.integers(min_value=0, max_value=10_000_000_00),
    sum_insured_paise=st.integers(min_value=0, max_value=10_000_000_00),
    entitlement_low_paise=st.integers(min_value=0, max_value=10_000_000_00),
    entitlement_high_paise=st.integers(min_value=0, max_value=10_000_000_00),
    mandate_min_paise=st.integers(min_value=0, max_value=10_000_000_00),
)
def test_target_lies_between_reservation_and_opening_ask(
    claimed_paise: int,
    sum_insured_paise: int,
    entitlement_low_paise: int,
    entitlement_high_paise: int,
    mandate_min_paise: int,
) -> None:
    model = build_value_model(
        claimed_paise=claimed_paise,
        sum_insured_paise=sum_insured_paise,
        entitlement_low_paise=entitlement_low_paise,
        entitlement_high_paise=entitlement_high_paise,
        mandate_min_paise=mandate_min_paise,
    )
    assert model.reservation_paise <= model.target_paise <= model.opening_ask_paise


def test_opening_ask_is_the_minimum_of_the_three_ceilings() -> None:
    model = build_value_model(
        claimed_paise=1_000_00,
        sum_insured_paise=2_000_00,
        entitlement_low_paise=300_00,
        entitlement_high_paise=500_00,
        mandate_min_paise=0,
    )
    assert model.opening_ask_paise == 500_00
