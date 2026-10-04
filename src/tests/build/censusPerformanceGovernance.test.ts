import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
const read = (path: string) => fs.readFileSync(path, 'utf8');
describe('census measurement release gate', () => {
  it('uses short PR screening, full push measurements, and the aggregate strict CI result', () => {
    const workflow = read('.github/workflows/ci-cd.yml');
    expect(workflow).toContain('environment: [development, production]');
    expect(workflow).toContain(
      "CENSUS_PERF_SAMPLES: ${{ github.event_name == 'pull_request' && '5' || '30' }}"
    );
    expect(workflow).toContain(
      "CENSUS_PERF_SMOKE: ${{ github.event_name == 'pull_request' && '1' || '0' }}"
    );
    expect(workflow).toContain('run: npm run test:census-performance-report');
    expect(workflow).toContain('run: npm run test:e2e:census-performance');
    expect(workflow).toContain(
      "CENSUS_PERFORMANCE_RESULT: ${{ needs['census-startup-performance'].result }}"
    );
    expect(workflow).toContain('"census-startup-performance:$CENSUS_PERFORMANCE_RESULT"');
    const summary = workflow.split('  ci-strict-summary:')[1].split('    env:')[0];
    expect(summary).toContain('census-startup-performance,');
  });
  it('keeps absolute production budgets blocking during short PR screening', () => {
    const spec = read('e2e/census-startup.measurement.ts');
    expect(spec).toContain("smoke\n      ? 'PR screening gate;");
    expect(spec).not.toContain('if (!smoke)\n    expect(\n      report.violations');
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
  it('retains production ceilings and the documented confirmed-cache bundle allowance', () => {
    const flow = JSON.parse(read('scripts/config/flow-performance-budgets.json'));
    expect(flow.flows.censoVisibleMs.enforcedMaxMs).toBe(2000);
    expect(flow.flows.censoRecordReadyMs.enforcedMaxMs).toBe(5000);
    const bundle = JSON.parse(read('scripts/config/bundle-budget.json'));
    expect(bundle.precacheMaxBytes).toBe(4952064);
    expect(
      bundle.startupChunkBudgets.find(
        (b: { label: string }) => b.label === 'app-authenticated-shell'
      ).maxBytes
    ).toBe(630000);
    expect(bundle.precacheIgnoredAssetPatterns).not.toContain('^assets/censusStartupPerf-.*\\.js$');
  });
});

describe('combined census measurement configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(['development', 'production'])(
    'keeps standalone %s startup measurements',
    async environment => {
      vi.stubEnv('CENSUS_PERF_ENV', environment);
      vi.stubEnv('CENSUS_PERF_INCLUDE_INTERACTIONS', '0');
      vi.resetModules();
      const { default: config } = await import('../../../playwright.census-performance.config');
      expect(config.projects?.map(project => project.name)).toEqual([
        'census-performance-chromium',
      ]);
      expect(config.webServer).toMatchObject({
        command: `node scripts/census-startup-performance-server.mjs ${environment}`,
        reuseExistingServer: false,
      });
    }
  );

  it('runs production interactions after startup against the same fresh server', async () => {
    vi.stubEnv('CENSUS_PERF_ENV', 'production');
    vi.stubEnv('CENSUS_PERF_INCLUDE_INTERACTIONS', '1');
    vi.resetModules();
    const { default: config } = await import('../../../playwright.census-performance.config');
    expect(config.projects).toHaveLength(2);
    expect(config.projects?.[0].testMatch).toBe('census-startup.measurement.ts');
    expect(config.projects?.[1]).toMatchObject({
      testMatch: 'census-interaction.measurement.ts',
      dependencies: ['census-performance-chromium'],
      timeout: 180_000,
      expect: { timeout: 5000 },
      outputDir: 'test-results/census-interactions',
    });
    expect(Array.isArray(config.webServer)).toBe(false);
    expect(config.webServer).toMatchObject({ reuseExistingServer: false });
    expect(config.retries).toBe(0);
    const workflow = read('.github/workflows/ci-cd.yml');
    expect(workflow).toContain(
      "CENSUS_PERF_INCLUDE_INTERACTIONS: ${{ matrix.environment == 'production' && '1' || '0' }}"
    );
    expect(workflow).not.toContain('run: npm run test:e2e:census-interactions');
  });

  it('rejects combined development measurements', async () => {
    vi.stubEnv('CENSUS_PERF_ENV', 'development');
    vi.stubEnv('CENSUS_PERF_INCLUDE_INTERACTIONS', '1');
    vi.resetModules();
    await expect(import('../../../playwright.census-performance.config')).rejects.toThrow(
      'Combined census measurements require production'
    );
  });
});
