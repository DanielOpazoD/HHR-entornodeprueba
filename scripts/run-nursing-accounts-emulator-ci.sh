#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/firebase-emulator-ci.sh"
ensure_java_available
firebase_bin="$(resolve_local_firebasetools)"
config="$(mktemp "${TMPDIR:-/tmp}/hhr-nursing-emulator.XXXXXX")"
trap 'rm -f "$config"' EXIT
node --input-type=module - "$config" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const emulators = { ui: { enabled: false }, singleProjectMode: true };
for (const name of ['auth', 'firestore', 'storage', 'hub', 'logging']) emulators[name] = { host: '127.0.0.1', port: await freePort() };
fs.writeFileSync(process.argv[2], JSON.stringify({ firestore: { rules: path.resolve('firestore.rules') }, storage: { rules: path.resolve('storage.rules') }, emulators }));
NODE
"$firebase_bin" emulators:exec --config "$config" --project demo-hhr-nursing-accounts --only auth,firestore,storage \
  'npx vitest run -c vitest.emulator.config.ts src/tests/emulator/nursing-accounts.emulator.test.ts --maxWorkers=1 && npx playwright test -c playwright.accounts.config.ts'
