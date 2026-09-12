# RecoveryAI

A disaster-recovery insurance claims platform. A flood or cyclone victim uploads their
policy and damage evidence; the platform verifies the disaster occurred, parses
coverage with citations, **files the claim for them**, then **negotiates the
settlement** with the insurer over multiple rounds — escalating to a grievance or
ombudsman complaint, also filed by the platform, if the insurer will not move.

Free for victims. Runs end to end with no external API keys and no paid services.

- [`implementation-plan.md`](implementation-plan.md) — the executable specification.
- [`research.md`](research.md) — product, regulatory and technical background.
- [`docs/architecture.md`](docs/architecture.md) — the runtime map.
- [`docs/adr/`](docs/adr/) — architecture decision records.

> **Status: Phase 0 complete.** The monorepo, local infrastructure, shared
> observability and configuration libraries, and the service and application shells
> are in place. Domain functionality lands in Phases 1–12.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| [Bun](https://bun.sh) | ≥ 1.2 | TypeScript runtime, package manager, test runner |
| [uv](https://docs.astral.sh/uv/) | ≥ 0.5 | Python dependency management |
| Docker | with Compose v2 | Local infrastructure |

## Setup

```bash
./scripts/bootstrap.sh    # prerequisites, .env, dependencies, images — idempotent
./scripts/dev.sh          # infrastructure + every service and app
```

Then, in another terminal:

```bash
./scripts/smoke.sh        # verifies every endpoint and a cross-service trace
```

To stop: `Ctrl-C` stops the services; `./scripts/dev.sh --down` stops the
infrastructure. `./scripts/dev.sh --infra-only` starts just the containers.

## Local URLs

| What | URL |
|---|---|
| Victim portal | http://localhost:3000 |
| Insurer sandbox console | http://localhost:3010 |
| Regulator/ombudsman sandbox console | http://localhost:3011 |
| Jaeger — distributed traces | http://localhost:16686 |
| Dozzle — container logs | http://localhost:8888 |
| MinIO console | http://localhost:9001 |
| Postgres | `localhost:5432` |

Service APIs are on ports 3001–3008 (TypeScript) and 8001–8002 (Python); each exposes
`/health/live` and `/health/ready`. See [docs/architecture.md](docs/architecture.md).

**Development credentials are synthetic.** `recoveryai / recoveryai` for Postgres and
`recoveryai / recoveryai-dev-secret` for MinIO are local-only values committed on
purpose; they are not secrets and must never be used anywhere real.

## Tests

```bash
./scripts/test-all.sh     # format, lint, typecheck, and every test in both runtimes

bun test                  # TypeScript unit tests
uv run pytest -q          # Python unit tests
bunx eslint .             # TypeScript lint
uv run ruff check .       # Python lint
```

No test requires a network, a credential, or a paid API.

## Provider configuration

Every external dependency is an adapter with a deterministic local implementation, and
the local one is the default ([ADR 0003](docs/adr/0003-mock-provider-strategy.md)):

```
KYC_PROVIDER=mock              DISASTER_PROVIDER=mock
GEOCODER_PROVIDER=mock         IMAGE_ANALYSIS_PROVIDER=mock
LLM_PROVIDER=mock              EMAIL_PROVIDER=console
OBJECT_STORAGE_PROVIDER=minio  INSURER_ADAPTER=sandbox
FILING_MODE=agent_files        FILING_ADAPTER_INSURER=sandbox
ESIGN_PROVIDER=local           FILING_ADAPTER_AUTHORITY=sandbox
```

See [`.env.example`](.env.example) for the full list. Real providers are optional
adapters; none is required to run, test or demo the system.

## Repository layout

```
apps/          platform-web, insurer-sandbox-web, regulator-sandbox-web
services/      8 TypeScript (Bun/Elysia) + 2 Python (FastAPI) services
packages/      shared TypeScript config, lint, observability and service runtime
python/common  shared Python settings, logging, tracing and app factory
infra/         Compose support files: Postgres init, MinIO buckets, OTel config
scripts/       bootstrap, dev, test-all, smoke
docs/          architecture and ADRs
```

## Troubleshooting

**`docker compose` fails to start.** Ensure the Docker daemon is running
(`docker info`). On macOS, open Docker Desktop first.

**A service reports 503 on `/health/ready`.** Readiness performs a real Postgres
round-trip. Check the infrastructure is up (`docker compose ps`) and that the
database for that service exists (`docker compose logs postgres`).

**Ports already in use.** Every port is configurable in `.env`; the defaults are
3000–3011, 5432, 8001–8002, 9000–9001, 16686 and 8888.

**No traces in Jaeger.** Confirm `OTEL_TRACES_ENABLED=true` and that
`OTEL_EXPORTER_OTLP_ENDPOINT` points at the collector (`http://localhost:4318`), then
exercise `curl http://localhost:3001/v1/diagnostics/trace-demo`.

**Python dependencies fail to resolve.** `uv sync --all-packages` from the repository
root; the workspace members are pinned there, not in each service.
