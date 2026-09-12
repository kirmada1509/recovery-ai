"""Canonical error envelope (plan Section 4.1), identical to the TypeScript services."""

from typing import Any


class AppError(Exception):
    """An error carrying an HTTP status and a stable machine-readable code."""

    def __init__(
        self,
        code: str,
        message: str,
        status: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


def error_envelope(
    code: str,
    message: str,
    request_id: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "requestId": request_id,
            "details": details or {},
        }
    }
