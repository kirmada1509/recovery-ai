"""Canonical error envelope (plan Section 4.1)."""

from recoveryai_common.runtime import AppError, error_envelope


def test_envelope_shape_matches_the_contract() -> None:
    assert error_envelope("CLAIM_NOT_FOUND", "Claim not found", "req-1", {"claimId": "c"}) == {
        "error": {
            "code": "CLAIM_NOT_FOUND",
            "message": "Claim not found",
            "requestId": "req-1",
            "details": {"claimId": "c"},
        }
    }


def test_details_default_to_an_empty_object() -> None:
    assert error_envelope("X", "y", "req-2")["error"]["details"] == {}


def test_app_error_carries_status_and_code() -> None:
    error = AppError("MANDATE_EXCEEDED", "Outside mandate", 403, {"limit": 100})
    assert (error.code, error.status, error.details["limit"]) == ("MANDATE_EXCEEDED", 403, 100)
