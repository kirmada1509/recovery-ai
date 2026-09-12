"""Mock providers (plan §18 P4-T3): deterministic, fixture-driven, no network.

The disaster fixtures are named so tests can address them by intent, the
same convention Phase 1 used for mock KYC (`identifierLast4 == '0000'` ->
deterministic failure): "chennai" is a confirmed event (drives PASS),
"ambiguous city" is a weak/unconfirmed signal (drives REVIEW), "faketown" is
a confident absence (drives FAIL via the mandatory-contradiction override in
the scoring engine). Any other location is treated cautiously — a low but
not confident absence — rather than optimistically.
"""

import json
from datetime import datetime
from pathlib import Path

from verification_service.providers.base import DisasterSignal, GeoPoint, ImageAnalysisResult

_FIXTURES_PATH = Path(__file__).parent.parent / "fixtures" / "disaster_events.json"
_DISASTER_FIXTURES: dict[str, dict[str, object]] = json.loads(_FIXTURES_PATH.read_text())

_DEFAULT_SIGNAL = DisasterSignal(
    occurred=False,
    confidence=0.6,
    reason="No known disaster event on record for this location; treated cautiously",
)


class MockDisasterProvider:
    async def check(
        self,
        incident_type: str,
        occurred_at: datetime | None,
        latitude: float | None,
        longitude: float | None,
        location_hint: str | None = None,
    ) -> DisasterSignal:
        key = (location_hint or "").strip().lower()
        fixture = _DISASTER_FIXTURES.get(key)
        if fixture is None:
            return _DEFAULT_SIGNAL
        return DisasterSignal(
            occurred=bool(fixture["occurred"]),
            confidence=float(fixture["confidence"]),  # type: ignore[arg-type]
            reason=str(fixture["reason"]),
            event_name=fixture["eventName"],  # type: ignore[arg-type]
        )


class MockGeocoderProvider:
    """No real geocoding; returns nothing so the location-consistency signal
    degrades gracefully rather than penalizing a claim for a gap in the mock."""

    async def resolve(self, address: str) -> GeoPoint | None:
        return None


class MockImageAnalysisProvider:
    async def analyze(self, image_ref: str, incident_type: str) -> ImageAnalysisResult:
        return ImageAnalysisResult(
            labels=[incident_type, "damage"],
            plausible_for_incident=True,
            confidence=0.85,
        )
