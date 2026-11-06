#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"
ensure_java_available
unset NO_COLOR || true

export NO_UPDATE_NOTIFIER=1
export PLAYWRIGHT_JSON_OUTPUT="${PLAYWRIGHT_JSON_OUTPUT:-reports/e2e/cudyr-playwright-report.json}"
export PLAYWRIGHT_HTML_OUTPUT_DIR="playwright-report/cudyr"
export FIRESTORE_EMULATOR_HOST
FIRESTORE_EMULATOR_HOST="$(resolve_firestore_emulator_host)"
mkdir -p "$(dirname "$PLAYWRIGHT_JSON_OUTPUT")"

cudyr_config="$(mktemp "${TMPDIR:-/tmp}/hhr-cudyr-emulator.XXXXXX")"
trap 'rm -f "$cudyr_config"' EXIT
write_firestore_emulator_config "$cudyr_config" "$FIRESTORE_EMULATOR_HOST"
firebase_bin="$(resolve_local_firebasetools)"
"$firebase_bin" --project demo-hhr-e2e emulators:exec --config "$cudyr_config" --only firestore "npm run test:e2e:cudyr-flow"
