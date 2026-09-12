"""Provider interfaces (plan Section 8.1-8.2 / §18 P4-T2).

Each is a `Protocol`, not a base class — the mock implementations in
`mock.py` are the only ones that exist today, but a real provider only needs
to satisfy the same shape, matching the mock/sandbox provider pattern already
established for KYC and disaster signals elsewhere in the plan.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class DisasterSignal:
    occurred: bool
    confidence: float
    reason: str
    event_name: str | None = None


@dataclass(frozen=True)
class GeoPoint:
    latitude: float
    longitude: float


@dataclass(frozen=True)
class ImageAnalysisResult:
    labels: list[str] = field(default_factory=list)
    plausible_for_incident: bool = True
    confidence: float = 0.5


class DisasterProvider(Protocol):
    # `location_hint` (e.g. a city name) is a fallback for claims that don't
    # yet carry precise coordinates — Phase 3's claim form doesn't collect
    # lat/lng, only a free-text address/city, so the mock provider matches on
    # that until geocoding lands.
    async def check(
        self,
        incident_type: str,
        occurred_at: datetime | None,
        latitude: float | None,
        longitude: float | None,
        location_hint: str | None = None,
    ) -> DisasterSignal: ...


class GeocoderProvider(Protocol):
    async def resolve(self, address: str) -> GeoPoint | None: ...


class ImageAnalysisProvider(Protocol):
    async def analyze(self, image_ref: str, incident_type: str) -> ImageAnalysisResult: ...
