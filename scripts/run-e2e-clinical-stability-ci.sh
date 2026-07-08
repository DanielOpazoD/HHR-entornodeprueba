#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"

ensure_java_available

unset NO_COLOR || true

export PLAYWRIGHT_JSON_OUTPUT="${PLAYWRIGHT_JSON_OUTPUT:-reports/e2e/clinical-stability-report.json}"
mkdir -p "$(dirname "$PLAYWRIGHT_JSON_OUTPUT")"

run_firestore_emulator_exec "npm run test:e2e:clinical-stability"
