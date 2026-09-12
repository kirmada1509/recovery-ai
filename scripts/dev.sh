#!/usr/bin/env bash
# Start local infrastructure, then every service and app, streaming their logs.
# Ctrl-C stops the processes; infrastructure keeps running (use --down to stop it).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "${REPO_ROOT}"
load_env

INFRA_ONLY=false
for arg in "$@"; do
  case "${arg}" in
    --infra-only) INFRA_ONLY=true ;;
    --down) log "Stopping infrastructure"; docker compose down; exit 0 ;;
    *) die "unknown argument: ${arg}" ;;
  esac
done

log "Starting infrastructure"
docker compose up -d --wait postgres minio otel-collector jaeger dozzle
docker compose up -d minio-init >/dev/null
ok "infrastructure healthy"

"${REPO_ROOT}/scripts/migrate.sh"

cat <<SUMMARY

  Postgres        localhost:5432
  MinIO console   http://localhost:9001   (recoveryai / recoveryai-dev-secret)
  Jaeger UI       http://localhost:16686
  Dozzle logs     http://localhost:8888

SUMMARY

if [[ "${INFRA_ONLY}" == true ]]; then
  ok "infrastructure only; services not started"
  exit 0
fi

PIDS=()
cleanup() {
  log "Stopping services"
  for pid in "${PIDS[@]}"; do kill "${pid}" 2>/dev/null || true; done
  wait 2>/dev/null || true
  ok "services stopped (infrastructure still running; ./scripts/dev.sh --down to stop it)"
}
trap cleanup EXIT INT TERM

for entry in "${TS_SERVICES[@]}"; do
  name="${entry%%:*}"; port="${entry##*:}"
  log "Starting ${name} on :${port}"
  # auth-service calls verification-service on its diagnostics route so the Phase 0
  # tracing gate exercises a real TypeScript -> Python trace.
  downstream=""
  [[ "${name}" == "auth-service" ]] && downstream="http://localhost:8001/v1/diagnostics/trace-demo"
  ( cd "services/${name}" \
    && PORT="${port}" \
       DATABASE_URL="$(database_url_for "${name}")" \
       DIAGNOSTICS_DOWNSTREAM_URL="${downstream}" \
       bun run dev 2>&1 | sed "s/^/[${name}] /" ) &
  PIDS+=($!)
done

for entry in "${PY_SERVICES[@]}"; do
  name="${entry%%:*}"; rest="${entry#*:}"; pkg="${rest%%:*}"; port="${rest##*:}"
  log "Starting ${name} on :${port}"
  ( cd "services/${name}" \
    && PORT="${port}" \
       DATABASE_URL="$(database_url_for "${name}")" \
       uv run uvicorn "${pkg}.main:app" --host 0.0.0.0 --port "${port}" --reload \
       2>&1 | sed "s/^/[${name}] /" ) &
  PIDS+=($!)
done

for entry in "${APPS[@]}"; do
  name="${entry%%:*}"; port="${entry##*:}"
  log "Starting ${name} on :${port}"
  ( cd "apps/${name}" && bun run dev 2>&1 | sed "s/^/[${name}] /" ) &
  PIDS+=($!)
done

ok "all processes started — Ctrl-C to stop"
wait
