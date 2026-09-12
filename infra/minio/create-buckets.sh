#!/bin/sh
# Private buckets for evidence and generated documents (plan Section 14.3).
# Buckets are never public; downloads go through short-lived signed URLs.
set -eu

mc alias set local http://minio:9000 "${MINIO_ROOT_USER:-recoveryai}" "${MINIO_ROOT_PASSWORD:-recoveryai-dev-secret}"

for bucket in recoveryai-evidence recoveryai-documents recoveryai-filings; do
  if mc ls "local/${bucket}" >/dev/null 2>&1; then
    echo "bucket ${bucket} already exists"
  else
    mc mb "local/${bucket}"
    echo "created bucket ${bucket}"
  fi
  mc anonymous set none "local/${bucket}"
done

echo "bucket initialisation complete"
