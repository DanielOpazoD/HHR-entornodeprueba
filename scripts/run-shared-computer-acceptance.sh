#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/firebase-emulator-ci.sh"
ensure_java_available
firebase_bin="$(resolve_local_firebasetools)"
config="$(mktemp "${TMPDIR:-/tmp}/hhr-shared-acceptance.XXXXXX")"
trap 'rm -f "$config"' EXIT
node --input-type=module - "$config" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pickEmulatorPorts } from './scripts/lib/emulatorPorts.mjs';
const emulators = { ui: { enabled: false }, singleProjectMode: true };
for (const [name, port] of Object.entries(await pickEmulatorPorts(['auth', 'firestore', 'hub', 'logging']))) {
  emulators[name] = { host: '127.0.0.1', port };
}
fs.writeFileSync(process.argv[2], JSON.stringify({ firestore: { rules: path.resolve('firestore.rules') }, emulators }));
NODE
npm run build:rules-assets
"$firebase_bin" emulators:exec --config "$config" --project demo-hhr-nursing-accounts --only auth,firestore \
  'npx playwright test -c playwright.shared-computer.config.ts'
