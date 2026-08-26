import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readReleaseGateScript = () =>
  fs.readFileSync(path.join(process.cwd(), 'scripts/run-firestore-release-gate-ci.sh'), 'utf8');

describe('firestore release gate script', () => {
  it('preserves critical evidence before refreshing the production-preview metric', () => {
    const script = readReleaseGateScript().replace(/\s+/g, ' ').replaceAll('\\"', '"');
    const pathGuard = script.indexOf('node scripts/check-playwright-report-path-isolation.mjs');
    const criticalRun = script.indexOf(
      'PLAYWRIGHT_JSON_OUTPUT="\\$E2E_CRITICAL_PLAYWRIGHT_JSON_OUTPUT" npm run test:e2e:critical'
    );
    const criticalGate = script.indexOf(
      'node scripts/check-playwright-report-clean.mjs "\\$E2E_CRITICAL_PLAYWRIGHT_JSON_OUTPUT" --label critical-e2e'
    );
    const performanceRun = script.indexOf(
      'PLAYWRIGHT_JSON_OUTPUT="\\$E2E_FLOW_PLAYWRIGHT_JSON_OUTPUT" npm run test:e2e:flow-performance:built'
    );

    expect(script).toContain('reports/e2e/critical-playwright-report.json');
    expect(script).toContain('reports/e2e/flow-performance-playwright-report.json');
    expect(pathGuard).toBeGreaterThanOrEqual(0);
    expect(criticalRun).toBeGreaterThan(pathGuard);
    expect(criticalGate).toBeGreaterThan(criticalRun);
    expect(performanceRun).toBeGreaterThan(criticalGate);
    expect(script.indexOf('npm run check:flow-performance-budget')).toBeGreaterThan(performanceRun);
  });
});
