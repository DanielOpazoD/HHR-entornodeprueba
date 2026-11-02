import { readFile } from 'node:fs/promises';

// The emulator's listening port is ready before its first rules compilation finishes.
// Complete that preparation before Playwright starts timing the clinical scenario.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host ?? '')) {
  throw new Error('Use the canonical loopback shared-computer emulator launcher.');
}
const projectId = 'demo-hhr-nursing-accounts';
const startedAt = performance.now();
const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}:securityRules`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    rules: { files: [{ content: await readFile('firestore.rules', 'utf8') }] },
  }),
  signal: AbortSignal.timeout(90_000),
});
if (!response.ok) {
  throw new Error(`Shared-computer rules preparation failed: HTTP ${response.status}`);
}
console.log(`Shared-computer emulator rules ready in ${Math.round(performance.now() - startedAt)}ms`);
