"""HMAC-signed service-to-service credentials (plan Section 2.5).

Byte-identical to `packages/internal-auth-ts` — same header names, same
`{service}.{timestamp}` HMAC-SHA256 construction, same tolerance window —
so a TS caller (claims-service) and this Python service agree on what a
valid signature is without sharing code.
"""

import hashlib
import hmac
import time
from dataclasses import dataclass

HEADER_SERVICE = "x-internal-service"
HEADER_TIMESTAMP = "x-internal-timestamp"
HEADER_SIGNATURE = "x-internal-signature"

_DEFAULT_TOLERANCE_MS = 30_000


@dataclass(frozen=True)
class InternalServiceToken:
    service: str
    timestamp: str
    signature: str


def _compute_signature(secret: str, service: str, timestamp: str) -> str:
    message = f"{service}.{timestamp}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def sign_internal_service_request(secret: str, service: str) -> InternalServiceToken:
    timestamp = str(int(time.time() * 1000))
    return InternalServiceToken(
        service=service,
        timestamp=timestamp,
        signature=_compute_signature(secret, service, timestamp),
    )


def verify_internal_service_request(
    service: str | None,
    timestamp: str | None,
    signature: str | None,
    *,
    secret: str,
    allowed_services: list[str],
    tolerance_ms: int = _DEFAULT_TOLERANCE_MS,
) -> bool:
    if not service or not timestamp or not signature:
        return False
    if service not in allowed_services:
        return False

    try:
        age_ms = (time.time() * 1000) - float(timestamp)
    except ValueError:
        return False
    if abs(age_ms) > tolerance_ms:
        return False

    expected = _compute_signature(secret, service, timestamp)
    return hmac.compare_digest(expected, signature)
