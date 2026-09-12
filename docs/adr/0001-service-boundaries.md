# ADR 0001 — Service boundaries and language split

- **Status:** Accepted
- **Date:** 2026-09-12
- **Plan reference:** Sections 2.1, 2.2, 4.7

## Context

The research reports disagreed about how many services to build and which language
each should use. One proposed Claims in Python; another put it in TypeScript; a third
routed all browser traffic through a Next.js API gateway.

We need a split that keeps money-handling logic boringly deterministic while giving
the probabilistic work access to the Python AI ecosystem.

## Decision

Ten services, each owning its own database, communicating over REST/JSON under `/v1`.

**TypeScript (Bun + Elysia + Drizzle)** — deterministic transactional domains:
auth, identity, claims, evidence, recovery-inbox, filing-gateway, insurer-sandbox,
regulator-sandbox.

**Python (FastAPI + SQLAlchemy)** — probabilistic and AI work: verification, agent
(including the negotiation engine).

No service reads another service's tables. Cross-service data moves through APIs and
persisted events, stored as external IDs. Browsers talk to services directly; there is
no gateway indirection in front of the domain APIs.

## Consequences

- The claim lifecycle and all monetary arithmetic live in a strongly-typed runtime
  where a wrong number is a compile error or a failing unit test, not a model output.
- Two toolchains must be installed, tested and containerised. `scripts/test-all.sh`
  runs both so the cost stays visible rather than surprising.
- Cross-service reads become API calls, which is more code but keeps each service's
  schema free to change behind its contract.
- The negotiation engine sits in Python next to the LLM, but is itself deterministic
  (see ADR 0007). Language choice does not imply probabilistic behaviour.
