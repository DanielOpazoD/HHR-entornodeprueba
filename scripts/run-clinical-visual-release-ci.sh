#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/firebase-emulator-ci.sh"
ensure_java_available
unset NO_COLOR || true
export PLAYWRIGHT_JSON_OUTPUT="${PLAYWRIGHT_JSON_OUTPUT:-reports/e2e/clinical-visual-release-report.json}"
run_firestore_emulator_exec "npx playwright test -c playwright.emulator-critical.config.ts e2e/clinical-release-visual-smoke.spec.ts --project=chromium"
