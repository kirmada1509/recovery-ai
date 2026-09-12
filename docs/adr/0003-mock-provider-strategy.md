# ADR 0003 — Mock-first provider adapters

- **Status:** Accepted
- **Date:** 2026-09-12
- **Plan reference:** Sections 2.6, 2.10, 9.7

## Context

The product depends on identity verification, disaster data, geocoding, image
analysis, LLMs, email and object storage. Every one of those is a credentialed,
rate-limited, sometimes paid external service. If any of them is required to run the
system, then a new contributor cannot start, CI cannot be trusted, and the demo
depends on someone's API quota.

There is also a data-protection reason: the KYC flow must be demonstrable without
handling a single real Aadhaar number.

## Decision

Every external dependency sits behind an interface with at least two implementations:
a real adapter and a deterministic local one. The local adapter is the default.

```
KYC_PROVIDER=mock              DISASTER_PROVIDER=mock
GEOCODER_PROVIDER=mock         IMAGE_ANALYSIS_PROVIDER=mock
LLM_PROVIDER=mock              EMAIL_PROVIDER=console
OBJECT_STORAGE_PROVIDER=minio  INSURER_ADAPTER=sandbox
FILING_ADAPTER_INSURER=sandbox FILING_ADAPTER_AUTHORITY=sandbox
```

Mock providers are deterministic, fixture-driven, and support the failure cases
(`pending`, `failed`, ambiguous disaster signals), not only the happy path. Tests may
never depend on a live paid model call.

## Consequences

- A fresh clone runs the entire system with no credentials. This is a hard
  requirement of the Definition of Done, not a convenience.
- Deterministic mocks make the negotiation and verification test suites reproducible,
  which is what allows property-based and seeded regression testing at all.
- Real adapters risk bit-rot because nothing exercises them locally. They are kept
  behind the same interface and contract-tested where a sandbox exists.
- No real identity data enters the repository or the demo.
