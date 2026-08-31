import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readPackageScripts = () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  return manifest.scripts as Record<string, string>;
};

const readCriticalCiScript = () =>
  fs.readFileSync(path.join(process.cwd(), 'scripts/run-e2e-critical-emulator-ci.sh'), 'utf8');

const readCriticalWorkflowJob = () => {
  const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8');
  return workflow.slice(workflow.indexOf('  e2e-critical-emulator:'), workflow.indexOf('  build:'));
};

const readClinicalStabilityCiScript = () =>
  fs.readFileSync(path.join(process.cwd(), 'scripts/run-e2e-clinical-stability-ci.sh'), 'utf8');

describe('E2E critical script governance', () => {
  it('keeps release performance budget out of the dev-server critical smoke pack', () => {
    const scripts = readPackageScripts();

    expect(scripts['test:e2e:critical']).not.toContain('startup-performance-budget.spec.ts');
    expect(scripts['test:e2e:flow-performance:built']).toContain(
      'startup-performance-budget.spec.ts'
    );
  });

  it('validates critical evidence before generating an isolated flow performance report', () => {
    const script = readCriticalCiScript().replace(/\s+/g, ' ').replaceAll('\\"', '"');
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

  it('reads operational metrics explicitly from the preserved critical report', () => {
    const workflowJob = readCriticalWorkflowJob();

    expect(workflowJob).toContain(
      'PLAYWRIGHT_JSON_OUTPUT: reports/e2e/critical-playwright-report.json'
    );
    expect(workflowJob).toContain(
      'E2E_FLOW_PLAYWRIGHT_JSON_OUTPUT: reports/e2e/flow-performance-playwright-report.json'
    );
    expect(workflowJob).toContain(
      'node scripts/report-e2e-operational-metrics.mjs reports/e2e/critical-playwright-report.json'
    );
    expect(workflowJob).toContain('path: |\n            reports/e2e/**');
  });

  it('keeps a focused clinical stability smoke for high-churn clinical flows', () => {
    const scripts = readPackageScripts();
    const clinicalStability = scripts['test:e2e:clinical-stability'];
    const clinicalStabilityCi = readClinicalStabilityCiScript().replace(/\s+/g, ' ');

    expect(clinicalStability).toContain('authenticated-clinical-smoke.spec.ts');
    expect(clinicalStability).toContain('admit-edit-discharge-smoke.spec.ts');
    expect(clinicalStability).toContain('census-persistence-reload.spec.ts');
    expect(clinicalStability).toContain('sync-conflict-resolution.spec.ts');
    expect(clinicalStability).toContain('clinical-document-ai-import.spec.ts');
    expect(clinicalStability).toContain('handoff-shift-export-smoke.spec.ts');
    expect(clinicalStability).toContain('backup-restore-export-smoke.spec.ts');
    expect(clinicalStability).toContain('reports/e2e/clinical-stability-report.json');
    expect(scripts['test:e2e:clinical-stability:ci']).toContain(
      'scripts/run-e2e-clinical-stability-ci.sh'
    );
    expect(clinicalStabilityCi).toContain('npm run test:e2e:clinical-stability');
  });

  it('keeps the remotely confirmed bed and crib lifecycle in the critical gate', () => {
    const scripts = readPackageScripts();

    expect(scripts['test:e2e:critical']).toContain('bed-crib-lifecycle-critical.spec.ts');
  });
});
