#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"

if [[ "${1:-}" == "--files" ]]; then
  shift
  command="$(node scripts/lib/emulatorTestFiles.mjs --command "$@")"
  ensure_java_available
  npm run build:rules-assets
  run_firestore_emulator_exec "node scripts/lib/emulatorTestFiles.mjs --prepare && $command" isolated
else
  ensure_java_available
  run_firestore_emulator_exec "npm run test:emulator:sync && npm run test:emulator:ui"
fi
