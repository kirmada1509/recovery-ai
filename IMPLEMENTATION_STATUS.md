# Implementation status

Tracks progress against the phases in [`implementation-plan.md`](implementation-plan.md)
Section 18. Updated as each phase gate passes.

| Phase | Scope | Status |
|---|---|---|
| **0** | Repository foundation and architecture guardrails | ✅ **Complete** |
| **1** | Authentication and identity/KYC | ✅ **Complete** |
| **2** | Evidence and policy upload | ✅ **Complete** |
| **3** | Claims lifecycle | ✅ **Complete** |
| 4 | Verification service | ⬜ Not started |
| 5 | Policy RAG and AI agent core | ⬜ Not started |
| 6 | Filing Gateway and sandbox backends | ⬜ Not started |
| 7 | Recovery Inbox, negotiation and filing closed loop | ⬜ Not started |
| 8 | Complete frontends | ⬜ Not started |
| 9 | Scenario engine and demo fixtures | ⬜ Not started |
| 10 | Security hardening | ⬜ Not started |
| 11 | Observability completion | ⬜ Not started |
| 12 | CI, docs, cleanup, final acceptance | ⬜ Not started |

## Phase 0 — complete

| Task | Delivered |
|---|---|
| **P0-T1** Monorepo bootstrap | Bun workspace; 3 Next.js apps; 8 TypeScript services; Python uv workspace with 2 FastAPI services; shared TypeScript, ESLint, Prettier, Ruff and mypy configuration; `.editorconfig`, `.gitignore`, `.env.example`; root scripts |
| **P0-T2** Docker Compose baseline | Postgres 17 (10 per-service databases), MinIO (3 private buckets), OTel Collector, Jaeger, Dozzle — all healthchecked |
| **P0-T3** Shared observability and settings | `@recoveryai/config-ts`, `@recoveryai/observability-ts`, `@recoveryai/service-runtime`, `recoveryai-common` (Python) |
| **P0-T4** Architecture docs | ADRs 0001–0007 and `docs/architecture.md` |

### Acceptance evidence

- `bun install` and `uv sync --all-packages` succeed from a clean checkout.
- `./scripts/test-all.sh` passes: Prettier, ESLint, Ruff lint + format, TypeScript
  typecheck (14 projects), mypy strict, 45 Bun tests, 27 pytest tests.
- `docker compose up -d --wait` reaches healthy on all five services; all 10 databases
  and 3 private buckets are created automatically.
- `./scripts/smoke.sh` passes: 10 services live **and** ready (readiness performs a
  real Postgres round-trip), 3 applications serving, 4 infrastructure endpoints up.
- One distributed trace spans both runtimes. `GET /v1/diagnostics/trace-demo` on
  auth-service produced trace `7369fd95…` with four correctly-parented spans:

  ```
  auth-service          GET /v1/diagnostics/trace-demo   (root)
  auth-service          diagnostics.work
  verification-service  GET /v1/diagnostics/trace-demo   (child of the above)
  verification-service  diagnostics.work
  ```

  Both services' JSON access logs carry that same `trace_id` with distinct `span_id`s.

### Deviations from the plan, and why

1. **Two packages added to the Section 3 layout** — `packages/config-ts` (Section 4.6
   requires a reusable settings-validation package) and `packages/service-runtime`
   (the Elysia bootstrap is identical across 8 services). The plan's layout has been
   updated to list both.
2. **`packages/ui`, `auth-client`, `api-contracts`, `test-fixtures` not created.** They
   have no content until the phases that need them; empty stub packages would be dead
   code, which Section 0.1 forbids.
3. **MinIO images pulled from `quay.io`**, not Docker Hub, where `minio/minio` no
   longer resolves.
4. **Ruff excludes `*.md`.** Ruff 0.16 reformats Python blocks inside Markdown and was
   rewriting the specification documents.

### Not yet implemented (by design)

Drizzle and SQLAlchemy models, Alembic migrations, and OpenAPI documents arrive with
the first service that owns real data (Phase 1). Services currently expose health and
diagnostics endpoints only — there are no stub business routes.

## Phase 1 — complete

| Task | Delivered |
|---|---|
| **P1-T1** Auth schema + migrations | `users` and `sessions` in auth-service; Drizzle over Bun's native `postgres` driver; a small migration runner (`src/db/migrate.ts`) applying `drizzle-kit generate` output, tracked in `_drizzle_migrations` |
| **P1-T2** Signup/login/logout | `POST /v1/auth/{signup,login,logout}`, `GET /v1/auth/me`; Argon2id via `Bun.password`; opaque refresh token hashed at rest; access JWT (HS256, ~15 min) with `sub`/`role`/`session_id`/`token_version`; `HttpOnly`/`SameSite=Lax` refresh cookie, never `localStorage` |
| **P1-T3** Refresh rotation | `POST /v1/auth/{refresh,logout-all}`; every refresh rotates the token and links the family via `parentSessionId`/`replacedBySessionId`; replaying a rotated token revokes the entire family; `logout-all` bumps `token_version` |
| **P1-T4** Role authorization | Victim/admin guard on `POST /v1/admin/users/:id/{disable,enable}`; a new shared package `@recoveryai/internal-auth-ts` (HMAC-signed, timestamped, replay-windowed service-to-service credentials) guarding identity-service's KYC provider webhook |
| **P1-T5** Identity profile | `profiles` in identity-service; `GET`/`PUT /v1/profile`, ownership enforced against the caller's access-token subject |
| **P1-T6** Mock KYC provider | `kyc_cases` in identity-service; `POST /v1/kyc/cases`, `GET /v1/kyc/cases/latest`, `POST /v1/kyc/mock/:caseId/complete` (gated by `ENABLE_KYC_MOCK_CONTROLS`), `POST /v1/kyc/provider/webhook` (internal-service-authenticated); deterministic outcome (`identifierLast4 === '0000'` fails, everything else verifies) |
| **P1-T7** Platform frontend onboarding | `apps/platform-web`: `/signup`, `/login`, `/profile`, `/kyc`; same-origin `/api/auth/*` and `/api/identity/*` proxy routes (no CORS, cookies never cross an origin); access token held in memory only, silently refreshed on load via the httpOnly cookie |

### Acceptance evidence

- Migrations apply cleanly from an empty database: `DROP DATABASE` + `CREATE DATABASE`
  for both `recoveryai_auth` and `recoveryai_identity`, then `./scripts/migrate.sh`
  creates `users`/`sessions` and `profiles`/`kyc_cases` from nothing.
- `./scripts/test-all.sh` passes: 90 Bun tests (up from 45 in Phase 0) including
  refresh-token rotation and reuse-detection, family-wide revocation, role
  authorization, two IDOR tests (cross-user profile read, cross-user KYC-case
  completion), internal-service-auth allow/deny, validation-envelope shape, and
  deterministic mock-KYC outcomes — plus 27 pytest tests, unchanged.
- The Phase 1 gate itself: `apps/platform-web/e2e/onboarding.spec.ts` (Playwright)
  signs up a victim, submits and completes mock KYC, reloads the page (forcing the
  silent-refresh path, not just an in-memory token), logs out, then confirms
  `/profile` redirects an unauthenticated visitor to `/login`. Passes against the
  live `./scripts/dev.sh` stack.
- Manually verified against the running stack (not just tests): reuse of an
  already-rotated refresh token returns `REFRESH_TOKEN_REUSED` and revokes the whole
  session family, including the token issued by the rotation that triggered it; an
  admin disabling a user immediately revokes that user's sessions and blocks further
  login, before their access token would otherwise expire.

### A bug the manual walkthrough caught that no test did

The refresh cookie auth-service sets is scoped to `Path=/v1/auth` — correct when
calling auth-service directly, meaningless through `platform-web`'s same-origin proxy,
where the browser only ever requests `/api/auth/*`. The cookie was being set and then
silently never sent back, so a full page reload always looked logged-out. Fixed by
rewriting `Path=/v1/` to `Path=/api/` on every `Set-Cookie` the proxy forwards
(`src/lib/backend-proxy.ts`). The Playwright test's `page.reload()` step exists
specifically to keep this fixed.

### Deviations from the plan, and why

1. **`CITEXT` not used for `users.email`.** Case-insensitive uniqueness is achieved by
   normalizing to lowercase before every read and write instead, avoiding a dependency
   on enabling the `citext` extension through a hand-written migration. Same guarantee,
   one fewer moving part.
2. **A new shared package, `@recoveryai/internal-auth-ts`**, not in the Section 3
   layout. Service-to-service HMAC signing/verification must be byte-identical on both
   sides; duplicating that logic per service risked drift in a way duplicating
   boilerplate elsewhere in the repo does not. The plan's layout has been updated.
3. **Migrations run via a small custom script, not `drizzle-kit migrate`.**
   `drizzle-kit migrate` requires a `pg`/`postgres` driver package; every service
   already uses Bun's native Postgres driver (`drizzle-orm/bun-sql`), so
   `src/db/migrate.ts` applies `drizzle-kit generate`'s SQL output directly through
   that driver, tracked in a `_drizzle_migrations` table. One fewer dependency, and the
   same driver runs both migrations and queries.
4. **Access tokens are verified independently by each service holding `JWT_SECRET`**,
   not by a call back to auth-service. The documented tradeoff: `logout-all` and
   account disablement are enforced immediately by auth-service (which checks
   `token_version` against the database) but take up to the ~15-minute access-token
   lifetime to be honored by other services. Refresh-token revocation is immediate
   everywhere, since every refresh is checked against the database.

### Not yet implemented (by design)

Admin-facing UI, KYC document upload, and a real (non-mock) KYC provider adapter are
out of scope for Phase 1 per the plan; `POST /v1/kyc/provider/webhook` exists as the
provider-abstraction boundary those would plug into.

## Phase 2 — complete

| Task | Delivered |
|---|---|
| **P2-T1** MinIO integration | `evidence-service` talks to MinIO through Bun's native `Bun.S3Client` (`src/lib/object-storage.ts`) — presigned PUT/GET, `stat`, `delete`, `write` — against the already-private `recoveryai-evidence` bucket |
| **P2-T2** Evidence metadata API | `documents`/`document_metadata` schema; `GET /v1/documents/:id`, `GET /v1/documents/:id/download-url`, `DELETE /v1/documents/:id`, all ownership-checked (`ownerUserId === caller.sub`, or `role === 'admin'`) |
| **P2-T3** Upload validation | MIME allowlist + max size enforced both at `initiate-upload` (declared) and `complete-upload` (re-checked against what MinIO actually received via `stat()`); storage keys are always a fresh `crypto.randomUUID()`, never the original filename; SHA-256 recorded |
| **P2-T4** Policy creation | `policies` in claims-service; `POST /v1/policies` calls evidence-service's own `GET /v1/documents/:id` with the caller's own token (no cross-service DB read) and rejects a document that isn't owned by the caller or isn't `ready` |
| **P2-T5** Frontend upload component | `apps/platform-web/src/components/upload-field.tsx` (progress/error/retry) on a new `/policy` page, driving `evidence-service`'s server-proxied `/v1/documents/upload` |

Both the presigned two-step flow (`initiate-upload` → client PUT → `complete-upload`) and
a single-call server-proxied `POST /v1/documents/upload` exist. The frontend uses the
proxied endpoint — a presigned PUT straight from the browser to MinIO would need MinIO
configured for cross-origin requests, which it isn't; the same-origin proxy hop is one
fewer moving part for files this size. The presigned flow is still real, tested, and
available (e.g. for a future admin tool or SDK integration).

### Acceptance evidence

- `./scripts/test-all.sh` passes: 103 Bun tests (up from 90), including evidence-service's
  full upload→read→download→delete lifecycle against real MinIO (the download URL is
  fetched and its bytes checked, not just its status code), rejection of a disallowed
  MIME type and an oversized file, and IDOR tests for read/download-url/delete plus an
  admin-bypass test; claims-service's policy creation validated against a stubbed
  evidence-service response (owned+ready / not-found / not-ready) and an IDOR test.
- Migrations apply cleanly from empty `recoveryai_evidence` and `recoveryai_claims`
  databases (drop/recreate, then `./scripts/migrate.sh`).
- Manually verified against the live `./scripts/dev.sh` stack, driven from inside the
  real browser session (not curl) for the upload step: signed up, uploaded a real PDF
  through the actual proxy + evidence-service + MinIO, created a policy referencing it,
  then confirmed from a second victim's session that reading the document, its
  download-url, and the policy all 404, while a promoted admin account could still read
  the document. This is the literal phase gate.
- `apps/platform-web/e2e/evidence-upload.spec.ts` (Playwright): signs up, uploads a real
  file via `page.setInputFiles`, and saves the policy — the only step Phase 1's approach
  (calling `app.handle()` directly) can't reach, since that never round-trips actual
  multipart form data through the browser and the Next.js proxy.

### Deviations from the plan, and why

1. **A new shared package, `@recoveryai/rate-limit-ts`.** Evidence-service's upload
   endpoint needed the same fixed-window limiter auth-service already had; moved out of
   `auth-service/src/lib/rate-limit.ts` rather than copy-pasted, following the same
   judgment call as `internal-auth-ts` in Phase 1 — a second real caller is what
   justifies the extraction, not doing it preemptively.
2. **`documents.sizeBytes` is `bigint` in Postgres but handled as a JS `number`**
   (`{ mode: 'number' }`), not a `bigint` value in application code. Safe up to ~9
   petabytes, far beyond `MAX_UPLOAD_SIZE_BYTES`; avoids `bigint`/`number` friction
   throughout the route and test code for no real benefit at this scale.
3. **SHA-256 on the direct-upload path is computed server-side from the request body**
   (a real hash of real bytes); on the presigned two-step path, `complete-upload`
   currently trusts a client-declared SHA-256 rather than re-fetching the object from
   MinIO to rehash it. Documented rather than silently accepted: this is real
   corruption/tamper detection on the path the frontend actually uses, and only a
   convenience checksum (no independent verification) on the presigned path, which is
   unused by any current caller. Independent server-side rehashing of the presigned
   path is a candidate for the security-hardening phase.

## Phase 3 — complete

| Task | Delivered |
|---|---|
| **P3-T1** Claims DB + state-transition module | `claims`, `claim_items`, `claim_evidence_links`, `claim_events`, `manual_review_tasks`, `verification_dispatch_outbox`, `idempotency_keys`; `src/domain/claim-state-machine.ts` encodes the *entire* Section 5.1 lifecycle (21 states) as a transition table, even though this phase only drives `DRAFT → SUBMITTED → VERIFYING` |
| **P3-T2** Draft claim APIs | Create/update a claim, add/edit/delete items (claim's running `claimedAmountPaise` total recomputed on every item change), link evidence documents (ownership re-validated against evidence-service, same pattern as Phase 2's policy creation) |
| **P3-T3** Submit endpoint | Validates KYC-verified, owned policy, ≥1 item, incident date+location, ≥1 linked document; `DRAFT → SUBMITTED → VERIFYING` in one transaction with an outbox row, all under one `Idempotency-Key` |
| **P3-T4** Background outbox dispatch | `src/workers/verification-dispatcher.ts` polls `verification_dispatch_outbox` with `FOR UPDATE SKIP LOCKED`, calls verification-service with internal-service auth, exponential backoff on failure (verified live against a 404, since Phase 4 doesn't exist yet — see below) |
| **P3-T5** Claim wizard + dashboard | `/claims/new` (incident → items → evidence → review, autosaving each step against the claim as it's created), `/claims` list, `/claims/:id` timeline |
| **P3-T6** Admin claim list/detail shell | `/admin/claims`, `/admin/claims/:id`, `/admin/manual-reviews` + a real (not shell) resolve endpoint — approving/rejecting records an immutable `claim_events` row; the "resume verification" behavior that follows an approval is Phase 4's P4-T7, since it depends on a `pass`/`review` decision Phase 4 produces |

### Acceptance evidence

- `./scripts/test-all.sh` passes: 157 Bun tests (up from 103), including all 21 documented
  state transitions plus 9 representative illegal ones, the full draft→submit lifecycle,
  the literal phase gate (duplicate submit with the same `Idempotency-Key` produces zero
  new events and exactly one outbox row), KYC-gated and evidence-gated submit rejection,
  the verification-result callback (pass/review, and idempotent replay of the same run),
  IDOR on claims/items/submit, and admin role + manual-review resolution.
- Migrations apply cleanly from an empty `recoveryai_claims` database.
- Three Playwright tests pass together: Phase 1's onboarding, Phase 2's upload, and a new
  `claim-submission.spec.ts` that drives the actual wizard UI (policy pick → incident →
  item → real file upload → review → submit) and asserts the claim detail page shows
  `VERIFYING` with the three expected timeline events — proving the browser flow, not
  just the API, since the wizard's own step-to-step state and autosave calls are exactly
  what a service-level test calling `app.handle()` can't exercise.
- Manually verified end to end against the live stack, including watching the outbox
  dispatcher's real behavior: it retried three times with increasing backoff against
  verification-service's (currently nonexistent) `/v1/verifications` route, logging
  `"verification-service responded 404"` each time — the dispatcher's failure path
  working as designed, not a bug, since Phase 4 hasn't been built yet. Separately called
  the internal verification-result callback directly (as Phase 4 will) to confirm
  `review → MANUAL_REVIEW` and the admin resolve flow both work correctly today.

### A bug this phase's manual walkthrough caught that no test did

`apps/platform-web`'s backend proxy (`src/lib/backend-proxy.ts`) only forwarded
`authorization`, `cookie`, and `content-type` headers — every other header, including
`Idempotency-Key`, was silently dropped. The claim wizard's submit button failed with
"An Idempotency-Key header is required" the first time it was clicked through the actual
browser, even though the identical request against claims-service directly (and every
integration test, which calls the route handler directly and never goes through the
proxy) worked. Fixed by forwarding `idempotency-key` explicitly. This is the same shape
of bug as Phase 1's refresh-cookie path issue: the proxy is a real seam that only a
through-the-browser test exercises.

### A correctness bug found while writing this phase's idempotency test

`drizzle-orm`'s built-in `jsonb()` column type calls `JSON.stringify()` on the value
before handing it to the driver. Bun's native Postgres client (`drizzle-orm/bun-sql`)
expects the *raw* JS value for a `jsonb` bind parameter — handing it an
already-stringified string causes Bun to bind it as plain text, which Postgres then
casts into a jsonb **string scalar** containing the JSON text, not a jsonb **object**.
`payload->>'key'` queries against such a column silently return `null` for every row,
with no error anywhere. This was invisible until the verification-result idempotency
test needed to query into `claim_events.payload` — every `jsonb` column written through
Drizzle before this fix (`claim_events.payload`, `verification_dispatch_outbox.payload`,
`idempotency_keys.response_body`, `evidence-service`'s `document_metadata.metadata`) was
affected. Fixed by defining a local `jsonb()` `customType` in both services' schema
files that passes the value through unchanged — confirmed via `jsonb_typeof()` before
and after, and reproduced independently against a bare `Bun.SQL` client outside Drizzle
entirely to confirm it wasn't a Drizzle bug but a driver-pairing one. No migration was
needed — the column's SQL type (`jsonb`) never changed, only how the JS value reaches it.

### Deviations from the plan, and why

1. **A `claim_evidence_links` join table**, not explicitly named in the plan's §6.3
   excerpt but required to normalize "≥1 linked evidence document" as a real relation
   rather than a JSON array on the claim row — matches the shape of `POST
   /v1/claims/:id/evidence-links` the plan does specify.
2. **An `idempotency_keys` table**, similarly not named in §6.3 but required to make the
   phase gate's literal wording — "duplicate submit does no new work" — actually
   enforceable: the response to a given key is stored once and replayed verbatim on
   retry, rather than re-deriving it from claim state (which would require the claim to
   still be in a re-derivable state, not true once verification has moved it further).
3. **A `fail` verification decision routes to `MANUAL_REVIEW`, not a terminal state.**
   The plan allows either "manual review or terminal branch based on configured reason";
   defaulting every failure to manual review means a human sees it before it becomes
   final, which is the safer default for an MVP with no configured reason codes yet.
4. **P4-T7's "queue Agent Service" step is not implemented as a stub call.** Agent
   Service doesn't exist until Phase 5. The manual-review approval path lands the
   `MANUAL_REVIEW → VERIFIED` transition and immutable event now; the next hook is
   deliberately absent rather than faked, per CLAUDE.md's prohibition on fake success
   responses.

### Not yet implemented (by design)

Everything past `VERIFYING` in the state machine (`READY_FOR_INSURER` onward) has no
driving logic yet — only the legal-transition table exists for those states, per Phase
3's explicit scope. Verification itself (Phase 4) doesn't exist, so a submitted claim's
outbox row will retry with backoff against a 404 until that phase lands; this is
expected, not a bug, and is exercised directly in this phase's tests via the internal
callback contract instead.
