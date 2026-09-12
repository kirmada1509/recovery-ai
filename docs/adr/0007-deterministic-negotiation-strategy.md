# ADR 0007 — Negotiation strategy is deterministic code

- **Status:** Accepted
- **Date:** 2026-09-12
- **Plan reference:** Sections 2.8, 10

## Context

The platform's value is the difference between the insurer's first offer and the final
settlement. An LLM is very good at writing a persuasive letter and very bad at being
accountable for a number. Left to a model, "what should we counter at?" is
unreproducible, untestable, and unexplainable to the user whose money it is.

## Decision

Split the negotiator in two.

**Code decides.** A pure, seeded, versioned strategy function takes the value model,
item ledger, session history, mandate and counterparty profile, and returns exactly
one typed move. No I/O, no model call, no hidden randomness. Same inputs and seed
always produce the same move.

**The model writes.** The LLM renders the chosen, fully-specified move into prose —
and its output is then validated against the structured move before it can be sent:
every number must appear in the move, every citation must resolve to a retrieved
chunk, no unmapped factual claims, no fabricated law, no threats.

Hard constraints live in the send path, not in a prompt: never below reservation,
never above the previous own ask, never outside the mandate, never a counter that
fails to reconcile to the line-item ledger. Insurer text is data and can never change
strategy.

## Consequences

- The engine can be property-tested and simulated offline against adversarial
  counterparty profiles, which is the only way to have any confidence in it.
- Every rupee of a counter-offer traces to a cited argument, so the user can be shown
  *why* — and an admin can audit it after the fact.
- The whole negotiation path works with `LLM_PROVIDER=mock` and a deterministic
  template renderer, so a model outage degrades prose quality, not correctness.
- Strategy improvements require code changes and new tests rather than prompt
  tweaking. That is slower, and it is the point.
