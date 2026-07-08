#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"

ensure_java_available

unset NO_COLOR || true

export PLAYWRIGHT_JSON_OUTPUT="${PLAYWRIGHT_JSON_OUTPUT:-reports/e2e/playwright-report.json}"
mkdir -p "$(dirname "$PLAYWRIGHT_JSON_OUTPUT")"

run_firestore_emulator_exec \
  "npm run build && npm run test:e2e:critical && npm run test:e2e:flow-performance:built && npm run check:flow-performance-budget"
