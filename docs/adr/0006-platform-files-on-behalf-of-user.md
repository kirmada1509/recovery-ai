# ADR 0006 — The platform files on the user's behalf

- **Status:** Accepted
- **Date:** 2026-09-12
- **Plan reference:** Sections 2.9, 11
- **Supersedes:** the research recommendation in `research.md` §18

## Context

`research.md` (§18) reports that IRDAI does not permit third parties to file claims or
grievances on a policyholder's behalf, and two of the four research reports concluded
from this that the user should perform the final submission themselves — the AI
prepares, the user clicks send on the insurer's own portal.

Applied literally, that ends every flow by handing a displaced flood victim a PDF and
a website address. The paperwork friction the product exists to remove would be
reintroduced at the exact moment the user is least able to absorb it.

## Decision

RecoveryAI files on the user's behalf, as their **authorized representative**.

- The policyholder remains the claimant of record. Nothing is filed in another name.
- The user signs a scoped, revocable letter of authorization in-app before the first
  filing. It is rendered to PDF, stored, and attached to every submission.
- Each filing is approved in one tap inside RecoveryAI, against a content hash of
  exactly what will be sent.
- The platform transmits — insurer submissions, documents, counter-offers, challenges,
  grievances and ombudsman complaints alike — and shows the user the receipt.
- The platform never impersonates: no user credentials, no claim of personal
  authorship, every submission attributed to RecoveryAI as representative.
- `FILING_MODE=user_assisted` exists for a jurisdiction or counterparty that genuinely
  forbids representative filing. Even then the platform prepares, signs and packages
  everything; only the transmission changes hands.

## Consequences

- The compliance posture rests on express written authorization, per-filing consent,
  non-impersonation and a complete audit trail — not on making the victim do the
  clicking. This is a defensible position, but it is a *position*, and it should be
  reviewed with counsel before any real-world deployment in India.
- Authorization and approval become load-bearing security surfaces: see the
  fail-closed guardrails in plan Section 11.7 and the non-repudiation requirements in
  Section 14.7.
- The system needs a fictional authority to file into, hence the regulator sandbox.
- A "no dead ends" lint and Playwright sweep enforce the promise, because a single
  well-meaning "download this form" string would quietly undo it.
