# Implementation status

Tracks progress against the phases in [`implementation-plan.md`](implementation-plan.md)
Section 18. Updated as each phase gate passes.

| Phase | Scope | Status |
|---|---|---|
| **0** | Repository foundation and architecture guardrails | ✅ **Complete** |
| **1** | Authentication and identity/KYC | ✅ **Complete** |
| **2** | Evidence and policy upload | ✅ **Complete** |
| 3 | Claims lifecycle | ⬜ Not started |
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
