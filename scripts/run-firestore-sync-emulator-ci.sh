#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"

if [[ "${1:-}" == "--files" ]]; then
  shift
  command="$(node scripts/lib/emulatorTestFiles.mjs --command "$@")"
  ensure_java_available
  npm run build:rules-assets
  run_firestore_emulator_exec "node scripts/lib/emulatorTestFiles.mjs --prepare && $command" isolated
elif [[ "${1:-}" == "--suite" ]]; then
  # CI runs each suite in its own job, each with its own emulator.
  suite="${2:-}"
  if [[ "$suite" != "sync" && "$suite" != "ui" ]]; then
    echo "Usage: $0 --suite sync|ui" >&2
    exit 2
  fi
  ensure_java_available
  run_firestore_emulator_exec "npm run test:emulator:$suite"
else
  ensure_java_available
  run_firestore_emulator_exec "npm run test:emulator:sync && npm run test:emulator:ui"
fi
