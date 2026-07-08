#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"

ensure_java_available

unset NO_COLOR || true

run_firestore_emulator_exec \
  "RUN_FIRESTORE_EMULATOR_TESTS=1 npx vitest run -c vitest.emulator.config.ts src/tests/emulator/cma-specialty-readback.emulator.test.ts"
