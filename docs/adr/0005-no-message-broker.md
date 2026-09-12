# ADR 0005 — No message broker for the MVP

- **Status:** Accepted
- **Date:** 2026-09-12
- **Plan reference:** Section 2.4

## Context

The system has genuinely asynchronous work: verification runs, agent workflows,
insurer webhooks, and outbound filings that must be retried. The obvious reach is for
Kafka, NATS or Redis. Each adds a container, an operational model, a failure mode and
a delivery-semantics discussion.

## Decision

No broker for the MVP. Instead:

- Persisted domain event and outbox tables record important state transitions in the
  same transaction as the state change.
- Background workers poll Postgres queues using `SELECT ... FOR UPDATE SKIP LOCKED`.
- Retries use bounded exponential backoff with idempotency keys; exhausted retries
  dead-letter to a manual review task rather than vanishing.

## Consequences

- Transactional outbox semantics come free: the event and the state change commit or
  roll back together, which a separate broker would not give us without extra work.
- Polling has latency and load characteristics a broker would not. At demo scale this
  is irrelevant; at production scale the outbox tables are the natural thing to drain
  into a real broker without changing producers.
- One less container, one less thing to explain, one less way for the local stack to
  be half-up.
