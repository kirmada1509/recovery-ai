"""Redaction and trace-context tests for the shared logger (plan Sections 4.2, 14.3)."""

from recoveryai_common.observability.logging import REDACTED_KEYS, _redact


def test_redacts_top_level_secrets() -> None:
    result = _redact(None, "info", {"password": "hunter2", "claim_id": "c-1"})
    assert result["password"] == "[REDACTED]"
    assert result["claim_id"] == "c-1"


def test_redacts_nested_secrets() -> None:
    result = _redact(None, "info", {"user": {"email": "a@b.c", "refresh_token": "tok"}})
    assert result["user"]["refresh_token"] == "[REDACTED]"
    assert result["user"]["email"] == "a@b.c"


def test_redacts_inside_lists() -> None:
    result = _redact(None, "info", {"items": [{"api_key": "k"}, {"name": "ok"}]})
    assert result["items"][0]["api_key"] == "[REDACTED]"
    assert result["items"][1]["name"] == "ok"


def test_redaction_is_case_insensitive() -> None:
    result = _redact(None, "info", {"Authorization": "Bearer x"})
    assert result["Authorization"] == "[REDACTED]"


def test_covers_the_documented_sensitive_fields() -> None:
    for key in ["aadhaar", "policy_text", "signed_url", "kyc_payload", "secret"]:
        assert key in REDACTED_KEYS
