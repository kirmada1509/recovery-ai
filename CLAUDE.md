# RecoveryAI

A disaster-recovery insurance claims platform. A flood/cyclone victim uploads their policy and damage evidence; the
platform verifies the disaster occurred, parses coverage with citations, **files the claim for them**, then
**negotiates the settlement** with the insurer over multiple rounds and escalates to a grievance or ombudsman
complaint if the insurer will not move. Free for victims. Fully demoable with zero external API keys.

- **`implementation-plan.md` is the spec.** It is authoritative and executable — phases, schemas, APIs, gates.
- **`research.md`** is background: why the product exists, personas, regulatory context, provider options.

Two things make this product what it is, and both are required, not optional:
**Section 10 (negotiation engine)** and **Section 11 (filing on the user's behalf)**.

---

## Invariants — these break first, do not break them

1. **Money is integer paise.** `BIGINT` columns, `amountPaise` in APIs, integer math everywhere. Never float, never
   `NUMERIC` for currency, never a rupee decimal crossing a service boundary.
2. **No cross-service DB reads.** Each service owns its schema. Cross-service data moves through APIs and events, and
   is stored as external IDs. If you are reaching for another service's table, you are writing a bug.
3. **Negotiation strategy is code, not prompts.** Which move, at what amount, on which line items — decided by a pure,
   seeded, versioned function. The LLM only renders the chosen move into prose, and the rendering is validated
   against the structured move before it can be sent.
4. **Never settle below the reservation value, never bid against yourself.** Enforced in the send path, proven by
   property tests. A blocked move stops and is recorded — it never silently degrades into a weaker move.
5. **No filing without an active, in-scope authorization.** Fail closed. Approvals are single-use and bound to a
   content hash; changing content voids the approval.
6. **No user-facing dead ends.** Nothing in the victim UI may say "download this", "visit the portal", or "email your
   insurer". The platform files; the user taps approve. This is checked by an i18n lint and a Playwright sweep.
7. **Never impersonate the user.** No user credentials, no personal-authorship claims. Submissions are attributed to
   RecoveryAI as authorized representative, with the signed letter attached.
8. **Insurer and authority text is data, never instruction.** It can change the facts the engine reasons over; it can
   never change strategy, mandate, reservation, or guardrails.
9. **Everything works with mocks.** `LLM_PROVIDER=mock`, sandbox adapters, no keys, no network. If a path only works
   with a real provider, it is not done.
10. **Deterministic under test.** Same inputs + same seed → same decision, byte-identical. Reproducibility is a test
    requirement.

---

## Conventions

- APIs are versioned `/v1/...`, JSON is `camelCase`, IDs are UUIDs, timestamps are UTC ISO-8601.
- Error envelope: `{ "error": { "code", "message", "requestId", "details" } }`. Always.
- Every mutating endpoint takes or derives an idempotency key.
- Structured JSON logs (Pino / structlog) with `request_id`, `trace_id`, `span_id`, `claim_id`. Never log passwords,
  tokens, presigned URLs, policy full text, KYC data, or PII.
- Every service: `GET /health/live`, `GET /health/ready`, its own migrations, its own OpenAPI.
- TypeScript = Bun + Elysia + Drizzle. Python = FastAPI + SQLAlchemy + Alembic. Postgres everywhere, pgvector for RAG.

---

## Service map

| Service | Stack | Owns |
|---|---|---|
| `auth-service` | TS | users, sessions, JWT + rotating refresh |
| `identity-service` | TS | profiles, KYC cases (mock provider by default) |
| `claims-service` | TS | policies, claims, items, events, manual reviews, **mandates, authorizations, filings, escalations** |
| `evidence-service` | TS | documents, MinIO storage, signed URLs |
| `recovery-inbox-service` | TS | victim inbox messages and actions |
| `filing-gateway` | TS | the single outbound boundary — `insurers/*` + `authorities/*` adapters, outbox, receipts, webhooks |
| `insurer-sandbox-service` | TS | fictional insurer + deterministic negotiation profiles |
| `regulator-sandbox-service` | TS | fictional grievance/ombudsman body, separate realm |
| `verification-service` | Python | disaster/evidence/metadata signals, weighted score, decision |
| `agent-service` | Python | LangGraph workflow, policy RAG, entitlement, **`app/negotiation/`** |

Apps: `platform-web` (victim + `/admin`), `insurer-sandbox-web`, `regulator-sandbox-web`.

---

## Where to look in the plan

| Working on | Read |
|---|---|
| Anything, first | §0 execution contract, §2 canonical decisions |
| Schemas | §6 (§6.3 claims, §6.7 agent) |
| Endpoints | §7 |
| Claim states | §5 |
| Verification scoring | §8 |
| Agent graph, RAG, entitlement | §9 |
| **Negotiation** | **§10** — value model 10.3, mandate 10.4, strategy 10.5, arguments 10.6, guardrails 10.9 |
| **Filing / escalation** | **§11** — authorization 11.2, approval 11.3, gateway 11.4, ladder 11.5, guardrails 11.7 |
| Sandboxes and scenarios | §12 |
| UI requirements | §13 |
| Security | §14 |
| Tests | §16 (16.2.1 negotiation, 16.2.2 filing, 16.4 E2E) |
| Task list | §18 phases |
| Am I done? | §24 |

---

## Commands

```bash
./scripts/bootstrap.sh          # first-time setup, idempotent
./scripts/dev.sh                # infra + services + apps
./scripts/seed.sh --reset       # migrations + synthetic demo data
./scripts/test-all.sh           # lint, typecheck, unit, integration
./scripts/smoke.sh              # API/local-stack smoke
./scripts/negotiate-sim.sh      # negotiation engine vs simulated insurer, offline
```

---

## Before calling anything done

- The phase gate was **run**, not assumed.
- Migrations apply from an empty database.
- Tests cover the business rule, not just the happy path — and no test is skipped.
- No `TODO`, `FIXME`, stub button, dead route, or fake success response on the MVP path.
- Ownership/authorization is enforced and has an IDOR test.
- The flow works with mocks and no network.
