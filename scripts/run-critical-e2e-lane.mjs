import { spawnSync } from 'node:child_process';
import { criticalLaneSpecs } from './criticalE2ELanes.mjs';
import { buildCriticalE2EEnvironment } from './config/criticalE2EEnvironment.mjs';

const lane = process.env.E2E_CRITICAL_LANE;
const specs = criticalLaneSpecs(lane);
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
};
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('A private emulator is required');
// Only the auxiliary lane needs a built preview for the unchanged flow budget.
if (lane === '3') run('npm', ['run', 'build'], buildCriticalE2EEnvironment());
run('npx', ['playwright', 'test', '-c', 'playwright.emulator-critical.config.ts', ...specs]);
run('node', [
  'scripts/check-playwright-report-clean.mjs',
  process.env.PLAYWRIGHT_JSON_OUTPUT,
  '--label',
  'critical-e2e',
]);
if (lane === '3') {
  run(
    'node',
    [
      'scripts/report-test-execution-manifest.mjs',
      '--capture',
      'playwright',
      '--suite',
      'flow',
      '--report',
      process.env.E2E_FLOW_PLAYWRIGHT_JSON_OUTPUT,
      '--output',
      'reports/execution/flow.evidence.json',
      '--',
      'npm',
      'run',
      'test:e2e:flow-performance:built',
    ],
    { ...process.env, PLAYWRIGHT_JSON_OUTPUT: process.env.E2E_FLOW_PLAYWRIGHT_JSON_OUTPUT }
  );
  run('npm', ['run', 'check:flow-performance-budget']);
}
