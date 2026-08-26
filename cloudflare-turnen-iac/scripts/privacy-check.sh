#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

d1_jurisdiction="$(terraform output -raw d1_jurisdiction)"
if [[ "$d1_jurisdiction" != "eu" ]]; then
  echo "ERROR: D1 jurisdiction is '$d1_jurisdiction', expected 'eu'." >&2
  exit 1
fi

export_bucket="$(terraform output -raw export_bucket_name 2>/dev/null || true)"
if [[ -n "$export_bucket" && "$export_bucket" != "null" ]]; then
  r2_jurisdiction="$(terraform output -raw export_bucket_jurisdiction)"
  if [[ "$r2_jurisdiction" != "eu" ]]; then
    echo "ERROR: R2 jurisdiction is '$r2_jurisdiction', expected 'eu'." >&2
    exit 1
  fi
fi

if grep -RInE '(allerg(y|ies)|medication|medical_notes|health_data).*(console\.log|logger\.)|(console\.log|logger\.).*(allerg(y|ies)|medication|medical_notes|health_data)' \
    worker/src 2>/dev/null; then
  echo "ERROR: possible health-data logging found." >&2
  exit 1
fi

echo "Privacy infrastructure checks passed."
