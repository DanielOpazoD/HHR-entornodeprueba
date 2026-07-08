#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"

ensure_java_available

run_storage_emulator_exec "npm run test:storage-rules"
