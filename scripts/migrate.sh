#!/usr/bin/env bash
# Applies pending migrations for every service that has them — Drizzle for
# TypeScript, Alembic for Python. Safe to run repeatedly — each tracks what
# it has already applied (plan Section 24: "migrations apply from an empty
# database").
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "${REPO_ROOT}"
load_env

for entry in "${TS_SERVICES[@]}"; do
  name="${entry%%:*}"
  if [[ ! -f "services/${name}/package.json" ]] || ! grep -q '"db:migrate"' "services/${name}/package.json"; then
    continue
  fi
  log "Migrating ${name}"
  ( cd "services/${name}" && DATABASE_URL="$(database_url_for "${name}")" bun run db:migrate )
  ok "${name} migrated"
done

for entry in "${PY_SERVICES[@]}"; do
  name="${entry%%:*}"
  if [[ ! -f "services/${name}/alembic.ini" ]]; then
    continue
  fi
  log "Migrating ${name}"
  ( cd "services/${name}" && DATABASE_URL="$(database_url_for "${name}")" uv run alembic upgrade head )
  ok "${name} migrated"
done
