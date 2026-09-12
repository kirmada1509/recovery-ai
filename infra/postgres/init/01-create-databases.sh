#!/bin/bash
# One logical database per service (plan Section 4.7). Services never read each
# other's tables, so each gets its own database on the shared local instance.
set -euo pipefail

DATABASES=(
  recoveryai_auth
  recoveryai_identity
  recoveryai_claims
  recoveryai_evidence
  recoveryai_inbox
  recoveryai_filing_gateway
  recoveryai_insurer_sandbox
  recoveryai_regulator_sandbox
  recoveryai_verification
  recoveryai_agent
)

for db in "${DATABASES[@]}"; do
  echo "creating database ${db}"
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname postgres <<-SQL
    SELECT 'CREATE DATABASE ${db}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\gexec
SQL
done

# pgvector is required by the agent service for policy retrieval (plan Section 6.7).
# The extension is created in Phase 5's migration; the database must exist first.
echo "database initialisation complete"
