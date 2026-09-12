#!/usr/bin/env bash
# First-time setup. Idempotent, and never overwrites an existing .env
# (plan Section 23).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "Checking prerequisites"
require_command bun "Install from https://bun.sh"
require_command uv "Install from https://docs.astral.sh/uv/"
require_command docker "Install Docker Desktop or an equivalent runtime"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"
ok "prerequisites present"

cd "${REPO_ROOT}"

if [[ -f .env ]]; then
  ok ".env already exists (left untouched)"
else
  cp .env.example .env
  ok "created .env from .env.example"
fi

log "Installing TypeScript dependencies"
bun install
ok "bun install complete"

log "Installing Python dependencies"
uv sync --all-packages
ok "uv sync complete"

log "Pulling infrastructure images"
docker compose pull --quiet
ok "images present"

cat <<'SUMMARY'

Bootstrap complete.

  ./scripts/dev.sh        start infrastructure, services and apps
  ./scripts/test-all.sh   run every static check and test
  ./scripts/smoke.sh      verify a running stack

SUMMARY
