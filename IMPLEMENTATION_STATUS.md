# Implementation status

Tracks progress against the phases in [`implementation-plan.md`](implementation-plan.md)
Section 18. Updated as each phase gate passes.

| Phase | Scope | Status |
|---|---|---|
| **0** | Repository foundation and architecture guardrails | ✅ **Complete** |
| 1 | Authentication and identity/KYC | ⬜ Not started |
| 2 | Evidence and policy upload | ⬜ Not started |
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
