#!/usr/bin/env bash
# Census and clinical explorer layout checks against the production build (vite preview), the way
# the hospital's 13-inch screens see it. Runs nightly; PRs keep the faster lanes.
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"

ensure_java_available

unset NO_COLOR || true

export PLAYWRIGHT_USE_PREVIEW=1
export PLAYWRIGHT_JSON_OUTPUT="${PLAYWRIGHT_JSON_OUTPUT:-reports/e2e/census-visual-nightly-report.json}"
export CENSUS_VISUAL_OUTPUT_DIR="${CENSUS_VISUAL_OUTPUT_DIR:-reports/e2e/census-visual}"
mkdir -p "$(dirname "$PLAYWRIGHT_JSON_OUTPUT")" "$CENSUS_VISUAL_OUTPUT_DIR"

run_firestore_emulator_exec "npx playwright test -c playwright.emulator-critical.config.ts e2e/census-13-inch-visual.spec.ts e2e/clinical-explorer-visual.spec.ts --project=chromium"
