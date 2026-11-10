import fs from 'node:fs';

export const CRITICAL_LANES = ['1', '2', '3'];
const partition = [
  [
    'auth-login-resilience.spec.ts',
    'eloisa-day-bootstrap-critical.spec.ts',
    'bed-crib-lifecycle-critical.spec.ts',
    'night-admission-sync-recovery-critical.spec.ts',
    'admit-edit-discharge-smoke.spec.ts',
    'legacy-firebase-compat.spec.ts',
    'auth-multi-tab-lock.spec.ts',
    'pre-outbox-multitab.spec.ts',
  ],
  [
    'multiuser-offline-conflict.spec.ts',
    'authenticated-clinical-smoke.spec.ts',
    'clinical-document-ai-import.spec.ts',
    'census-persistence-reload.spec.ts',
    'rayen-mother-newborn-d1-discharge-critical.spec.ts',
    'critical-emulator.spec.ts',
    'manual-eloisa-patient-code.spec.ts',
  ],
  [
    'census-specialty-save.spec.ts',
    'sync-conflict-resolution.spec.ts',
    'rayen-delayed-health-preflight.spec.ts',
    'release-role-smoke.spec.ts',
    'auth-fixture-readiness.spec.ts',
  ],
];

export const criticalLaneSpecs = (lane, root = process.cwd()) => {
  if (!CRITICAL_LANES.includes(lane)) throw new Error('Unknown critical lane');
  const scripts = JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8')).scripts;
  const specs = scripts['test:e2e:critical']
    .split(/\s+/)
    .filter(arg => /^e2e\/.*\.spec\.ts$/.test(arg));
  const all = partition.flat().map(file => `e2e/${file}`);
  if (
    new Set(all).size !== all.length ||
    specs.length !== all.length ||
    specs.some(file => !all.includes(file))
  )
    throw new Error('Critical lane partition differs from the canonical suite');
  return specs.filter(file => partition[Number(lane) - 1].includes(file.slice(4)));
};
