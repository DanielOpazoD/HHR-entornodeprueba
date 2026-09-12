import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => fs.readFileSync(path, 'utf8');
describe('census measurement release gate', () => {
  it('requires both environments, 30 samples, and the aggregate strict CI result', () => {
    const workflow = read('.github/workflows/ci-cd.yml');
    expect(workflow).toContain('environment: [development, production]');
    expect(workflow).toContain("CENSUS_PERF_SAMPLES: '30'");
    expect(workflow).toContain('run: npm run test:census-performance-report');
    expect(workflow).toContain('run: npm run test:e2e:census-performance');
    expect(workflow).toContain(
      "CENSUS_PERFORMANCE_RESULT: ${{ needs['census-startup-performance'].result }}"
    );
    expect(workflow).toContain('"census-startup-performance:$CENSUS_PERFORMANCE_RESULT"');
    const summary = workflow.split('  ci-strict-summary:')[1].split('    env:')[0];
    expect(summary).toContain('census-startup-performance,');
  });
  it('does not erase slow samples via retries or mix production secrets with fixtures', () => {
    const config = read('playwright.census-performance.config.ts');
    expect(config).toContain('retries: 0');
    expect(config).toContain('forbidOnly: true');
    expect(config).toContain('reuseExistingServer: false');
    // Waits must never be derived from, or silently become, performance budgets.
    expect(config).toContain('CENSUS_PERF_READINESS_TIMEOUT_MS');
    expect(config).toContain("trace: 'retain-on-failure'");
    expect(config).toContain("screenshot: 'only-on-failure'");
    // Waits live in the config; verdicts live in the report module.
    expect(config).not.toContain('enforcedMaxMs');
    expect(read('scripts/census-startup-performance-report.mjs')).toContain('enforcedMaxMs');
    const workflow = read('.github/workflows/ci-cd.yml');
    expect(workflow).toContain('test-results/census-performance/**');
    expect(read('e2e/census-startup.measurement.ts')).toContain('Screen state:');
    const server = read('scripts/census-startup-performance-server.mjs');
    expect(server).toContain('envDir: false');
    expect(server).toContain('delete process.env[key]');
    expect(server).not.toContain('.env.production');
    const spec = read('e2e/census-startup.measurement.ts');
    expect(spec).toContain("route.abort('blockedbyclient')");
    expect(spec).toContain('const url = new URL(route.request().url())');
    expect(spec).not.toContain('previewFirebase');
  });
  it('retains all pre-existing production and bundle ceilings', () => {
    const flow = JSON.parse(read('scripts/config/flow-performance-budgets.json'));
    expect(flow.flows.censoVisibleMs.enforcedMaxMs).toBe(2000);
    expect(flow.flows.censoRecordReadyMs.enforcedMaxMs).toBe(5000);
    const bundle = JSON.parse(read('scripts/config/bundle-budget.json'));
    expect(bundle.precacheMaxBytes).toBe(4952064);
    expect(
      bundle.startupChunkBudgets.find(
        (b: { label: string }) => b.label === 'app-authenticated-shell'
      ).maxBytes
    ).toBe(623000);
    expect(bundle.precacheIgnoredAssetPatterns).not.toContain('^assets/censusStartupPerf-.*\\.js$');
  });
});
