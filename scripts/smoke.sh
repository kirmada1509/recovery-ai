#!/usr/bin/env bash
# Verify a running local stack: every service is live, ready, and traced
# (plan Section 23.6).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "${REPO_ROOT}"
load_env
FAILED=()

check_endpoint() {
  local name="$1" url="$2" expected="${3:-200}"
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${url}" || echo 000)"
  if [[ "${status}" == "${expected}" ]]; then
    ok "${name} ${url} -> ${status}"
  else
    warn "${name} ${url} -> ${status} (expected ${expected})"
    FAILED+=("${name}")
  fi
}

log "Infrastructure"
check_endpoint "jaeger"  "http://localhost:16686/"
check_endpoint "dozzle"  "http://localhost:8888/"
check_endpoint "minio"   "http://localhost:9000/minio/health/live"
check_endpoint "otel-collector" "http://localhost:13133/"

log "TypeScript services"
for entry in "${TS_SERVICES[@]}"; do
  name="${entry%%:*}"; port="${entry##*:}"
  check_endpoint "${name} live"  "http://localhost:${port}/health/live"
  check_endpoint "${name} ready" "http://localhost:${port}/health/ready"
done

log "Python services"
for entry in "${PY_SERVICES[@]}"; do
  name="${entry%%:*}"; port="${entry##*:}"
  check_endpoint "${name} live"  "http://localhost:${port}/health/live"
  check_endpoint "${name} ready" "http://localhost:${port}/health/ready"
done

log "Applications"
for entry in "${APPS[@]}"; do
  name="${entry%%:*}"; port="${entry##*:}"
  check_endpoint "${name}" "http://localhost:${port}/"
done

log "Distributed trace (TypeScript -> Python)"
TRACE_RESPONSE="$(curl -fsS --max-time 10 \
  -H 'x-request-id: smoke-trace' \
  "http://localhost:3001/v1/diagnostics/trace-demo" 2>/dev/null || echo '')"
if [[ -n "${TRACE_RESPONSE}" ]] && echo "${TRACE_RESPONSE}" | grep -q '"status":200'; then
  ok "auth-service -> verification-service traced call succeeded"
else
  warn "cross-service trace demo failed: ${TRACE_RESPONSE:-no response}"
  FAILED+=("trace-demo")
fi

if [[ ${#FAILED[@]} -gt 0 ]]; then
  printf '\n'
  die "smoke failures: ${FAILED[*]}"
fi

printf '\n'
ok "smoke passed — traces at http://localhost:16686, logs at http://localhost:8888"
