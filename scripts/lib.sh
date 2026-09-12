#!/usr/bin/env bash
# Shared helpers for the RecoveryAI scripts.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export REPO_ROOT

# Every TypeScript service: name:port
TS_SERVICES=(
  "auth-service:3001"
  "identity-service:3002"
  "claims-service:3003"
  "evidence-service:3004"
  "recovery-inbox-service:3005"
  "filing-gateway:3006"
  "insurer-sandbox-service:3007"
  "regulator-sandbox-service:3008"
)

# Every Python service: name:package:port
PY_SERVICES=(
  "verification-service:verification_service:8001"
  "agent-service:agent_service:8002"
)

APPS=(
  "platform-web:3000"
  "insurer-sandbox-web:3010"
  "regulator-sandbox-web:3011"
)

log()  { printf '\033[0;36m›\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed. $2"
}

# Map a service name to its DATABASE_URL environment variable.
database_url_for() {
  case "$1" in
    auth-service)              echo "${AUTH_DATABASE_URL:-}" ;;
    identity-service)          echo "${IDENTITY_DATABASE_URL:-}" ;;
    claims-service)            echo "${CLAIMS_DATABASE_URL:-}" ;;
    evidence-service)          echo "${EVIDENCE_DATABASE_URL:-}" ;;
    recovery-inbox-service)    echo "${INBOX_DATABASE_URL:-}" ;;
    filing-gateway)            echo "${FILING_GATEWAY_DATABASE_URL:-}" ;;
    insurer-sandbox-service)   echo "${INSURER_SANDBOX_DATABASE_URL:-}" ;;
    regulator-sandbox-service) echo "${REGULATOR_SANDBOX_DATABASE_URL:-}" ;;
    verification-service)      echo "${VERIFICATION_DATABASE_URL:-}" ;;
    agent-service)             echo "${AGENT_DATABASE_URL:-}" ;;
    *) die "unknown service: $1" ;;
  esac
}

load_env() {
  local env_file="${REPO_ROOT}/.env"
  [[ -f "${env_file}" ]] || env_file="${REPO_ROOT}/.env.example"
  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
}

wait_for_http() {
  local url="$1" name="$2" attempts="${3:-60}"
  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS --max-time 2 "${url}" >/dev/null 2>&1; then
      ok "${name} is up"
      return 0
    fi
    sleep 1
  done
  return 1
}
