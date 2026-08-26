#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"

ensure_java_available

unset NO_COLOR || true

critical_report="${PLAYWRIGHT_JSON_OUTPUT:-reports/e2e/critical-playwright-report.json}"
performance_report="${E2E_FLOW_PLAYWRIGHT_JSON_OUTPUT:-reports/e2e/flow-performance-playwright-report.json}"

mkdir -p "$(dirname "$critical_report")" "$(dirname "$performance_report")"
node scripts/check-playwright-report-path-isolation.mjs "$critical_report" "$performance_report"

export E2E_CRITICAL_PLAYWRIGHT_JSON_OUTPUT="$critical_report"
export E2E_FLOW_PLAYWRIGHT_JSON_OUTPUT="$performance_report"

run_firestore_emulator_exec \
  "npm run build && npm run test:rules && npm run test:emulator:sync && npm run test:emulator:ui && PLAYWRIGHT_JSON_OUTPUT=\"\$E2E_CRITICAL_PLAYWRIGHT_JSON_OUTPUT\" npm run test:e2e:critical && node scripts/check-playwright-report-clean.mjs \"\$E2E_CRITICAL_PLAYWRIGHT_JSON_OUTPUT\" --label critical-e2e && PLAYWRIGHT_JSON_OUTPUT=\"\$E2E_FLOW_PLAYWRIGHT_JSON_OUTPUT\" npm run test:e2e:flow-performance:built && npm run check:flow-performance-budget"
