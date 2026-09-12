#!/usr/bin/env bash
# Every static check and test. This is what CI runs (plan Section 17.1).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "${REPO_ROOT}"
FAILED=()

step() {
  local name="$1"; shift
  log "${name}"
  if "$@"; then ok "${name}"; else warn "${name} FAILED"; FAILED+=("${name}"); fi
}

step "prettier (format check)" bunx prettier --check .
step "eslint" bunx eslint .
step "ruff (lint)" uv run ruff check .
step "ruff (format check)" uv run ruff format --check .

log "TypeScript typecheck"
TS_OK=true
for dir in packages/config-ts packages/observability-ts packages/service-runtime packages/internal-auth-ts \
           services/auth-service services/identity-service services/claims-service \
           services/evidence-service services/recovery-inbox-service services/filing-gateway \
           services/insurer-sandbox-service services/regulator-sandbox-service \
           apps/platform-web apps/insurer-sandbox-web apps/regulator-sandbox-web; do
  if ! ( cd "${dir}" && bunx tsc --noEmit ); then
    warn "typecheck failed in ${dir}"
    TS_OK=false
  fi
done
if [[ "${TS_OK}" == true ]]; then ok "TypeScript typecheck"; else FAILED+=("TypeScript typecheck"); fi

step "mypy" uv run mypy python/common/src services/verification-service/verification_service services/agent-service/agent_service
step "bun test" bun test --path-ignore-patterns '**/e2e/**'
step "pytest" uv run pytest -q

if [[ ${#FAILED[@]} -gt 0 ]]; then
  printf '\n'
  die "failed: ${FAILED[*]}"
fi

printf '\n'
ok "all checks passed"
