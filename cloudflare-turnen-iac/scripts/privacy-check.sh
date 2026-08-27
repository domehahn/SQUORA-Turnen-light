#!/usr/bin/env bash
# Läuft nach `tofu apply`/`terraform apply` - prüft die von Terraform
# verwaltete Infrastruktur (aktuell nur D1) sowie, unabhängig davon, den
# echten Worker-Quellcode auf offensichtliches Logging sensibler Daten.
#
# Ergänzt (nicht ersetzt) das ausführlichere scripts/privacy-check.ts im
# Hauptprojekt (turnen/); dieses Skript hier ist bewusst minimal und ohne
# Node-Abhängigkeit lauffähig.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TF="terraform"
command -v terraform >/dev/null 2>&1 || TF="tofu"

d1_jurisdiction="$("$TF" output -raw d1_jurisdiction)"
if [[ "$d1_jurisdiction" != "eu" ]]; then
  echo "ERROR: D1 jurisdiction is '$d1_jurisdiction', expected 'eu'." >&2
  exit 1
fi

# Realer Worker-Quellcode liegt im Hauptprojekt, nicht in diesem
# IaC-Repository (Code-Deployment bleibt bei Wrangler, s. README.md).
APP_WORKER_SRC="$ROOT/../turnen/worker/src"
if [[ -d "$APP_WORKER_SRC" ]]; then
  if grep -RInE '(allerg(y|ies)|medication|medical_notes|health_data|health_notes).*(console\.log|logger\.)|(console\.log|logger\.).*(allerg(y|ies)|medication|medical_notes|health_data|health_notes)' \
      "$APP_WORKER_SRC" 2>/dev/null; then
    echo "ERROR: possible health-data logging found in $APP_WORKER_SRC." >&2
    exit 1
  fi
else
  echo "WARNUNG: $APP_WORKER_SRC nicht gefunden - Health-Data-Logging-Check übersprungen." >&2
fi

echo "Privacy infrastructure checks passed."
