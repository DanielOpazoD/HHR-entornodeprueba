#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/firebase-emulator-ci.sh"
ensure_java_available

firebase_bin="$(resolve_local_firebasetools)"
export FIRESTORE_EMULATOR_HOST="$(resolve_firestore_emulator_host)"
auth_host="${FIREBASE_AUTH_EMULATOR_HOST:-127.0.0.1:19099}"
auth_port="${auth_host##*:}"
if [[ ! "$FIRESTORE_EMULATOR_HOST" =~ ^(127\.0\.0\.1|localhost):[0-9]+$ ]] ||
   [[ ! "$auth_host" =~ ^(127\.0\.0\.1|localhost):[0-9]+$ ]]; then
  echo 'This measurement requires loopback-only emulator endpoints.' >&2
  exit 1
fi
if [[ ! "$auth_port" =~ ^[0-9]+$ ]] || ! is_tcp_port_available "$auth_port"; then
  echo "Auth emulator port is unavailable: $auth_host" >&2
  exit 1
fi
export FIREBASE_AUTH_EMULATOR_HOST="$auth_host"
export VITE_AUTH_EMULATOR_HOST="http://$auth_host"
export VITE_FIRESTORE_EMULATOR_HOST="$FIRESTORE_EMULATOR_HOST"
export PLAYWRIGHT_WEB_SERVER_PORT="${PLAYWRIGHT_WEB_SERVER_PORT:-4319}"
export PLAYWRIGHT_FORCE_FRESH_SERVER=1
export PLAYWRIGHT_JSON_OUTPUT="${PLAYWRIGHT_JSON_OUTPUT:-reports/e2e/census-remote-performance.json}"
export NO_UPDATE_NOTIFIER=1
mkdir -p "$(dirname "$PLAYWRIGHT_JSON_OUTPUT")"

config_path="$(mktemp "${TMPDIR:-/tmp}/hhr-census-remote-perf.XXXXXX")"
trap 'rm -f "$config_path"' EXIT
write_firestore_emulator_config "$config_path" "$FIRESTORE_EMULATOR_HOST"
node - "$config_path" "$auth_host" <<'NODE'
const fs = require('node:fs');
const [configPath, authHost] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const [host, port] = authHost.split(':');
if (!host || !Number.isInteger(Number(port))) throw new Error('Invalid auth emulator host');
config.emulators.auth = { host, port: Number(port) };
config.emulators.ui = { enabled: false };
fs.writeFileSync(configPath, JSON.stringify(config));
NODE

"$firebase_bin" emulators:exec --project demo-hhr-e2e --config "$config_path" \
  --only auth,firestore \
  'npx playwright test -c playwright.emulator-critical.config.ts e2e/census-remote-performance.spec.ts --project=chromium'
