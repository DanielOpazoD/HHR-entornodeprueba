// @vitest-environment node
import { ONLINE_ONLY_PRECACHE_PATTERNS } from '../../../scripts/config/onlineOnlyAssets.mjs';
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';
const read = (path: string) => fs.readFileSync(path, 'utf8');
const ciJobs = () => parseWorkflow(read('.github/workflows/ci-cd.yml')).jobs;
describe('census measurement release gate', () => {
  it('uses short PR screening, full push measurements, and the aggregate strict CI result', () => {
    const jobs = ciJobs();
    const census = jobs['census-startup-performance'];
    expect(census.strategy?.matrix.environment).toEqual(['development', 'production']);
    const runs = census.steps.map(step => step.run);
    expect(runs).toContain('npm run test:census-performance-report');
    const measure = census.steps.find(step => step.run === 'npm run test:e2e:census-performance');
    expect(measure?.env).toMatchObject({
      CENSUS_PERF_SAMPLES: "${{ github.event_name == 'pull_request' && '5' || '30' }}",
      CENSUS_PERF_SMOKE: "${{ github.event_name == 'pull_request' && '1' || '0' }}",
    });
    const summary = jobs['ci-strict-summary'];
    expect(jobNeeds(summary)).toContain('census-startup-performance');
    expect(summary.env?.CENSUS_PERFORMANCE_RESULT).toBe(
      "${{ needs['census-startup-performance'].result }}"
    );
    expect(
      summary.steps.some(step =>
        step.run?.includes('"census-startup-performance:$CENSUS_PERFORMANCE_RESULT"')
      )
    ).toBe(true);
  });
  it('keeps production fixtures isolated from secrets and uploads failure artifacts', () => {
    const uploads = ciJobs()['census-startup-performance'].steps.filter(step =>
      step.uses?.startsWith('actions/upload-artifact@')
    );
    expect(
      uploads.some(step => String(step.with?.path).includes('test-results/census-performance/**'))
    ).toBe(true);
    const server = read('scripts/census-startup-performance-server.mjs');
    expect(server).toContain('envDir: false');
    expect(server).toContain('delete process.env[key]');
    expect(server).not.toContain('.env.production');
    const spec = read('e2e/census-startup.measurement.ts');
    expect(spec).toContain("route.abort('blockedbyclient')");
    expect(spec).not.toContain('previewFirebase');
  });
  it('retains production ceilings and the documented critical-runtime bundle allowances', () => {
    const flow = JSON.parse(read('scripts/config/flow-performance-budgets.json'));
    expect(flow.flows.censoVisibleMs.enforcedMaxMs).toBe(2000);
    expect(flow.flows.censoRecordReadyMs.enforcedMaxMs).toBe(5000);
    const bundle = JSON.parse(read('scripts/config/bundle-budget.json'));
    // The measured 40 KiB Zod security allowance and the owner-approved 2026-10-25 raise
    // of 38 KiB, plus the bounded shared crash-cart allowance and the census program's measured uses
    // (BUNDLE_RISK_LEDGER.md).
    expect(bundle.precacheMaxBytes).toBe(
      4952064 + 40960 + 38912 + 8192 + 4096 + 2048 + 512 + 1536 + 3072 + 5120
    );
    // Measured shell plus ~5% once startup modules left it (2026-11-19; BUNDLE_RISK_LEDGER.md).
    expect(
      bundle.startupChunkBudgets.find(
        (b: { label: string }) => b.label === 'app-authenticated-shell'
      ).maxBytes
    ).toBe(349000);
    expect(ONLINE_ONLY_PRECACHE_PATTERNS).not.toContain('^assets/censusStartupPerf-.*\\.js$');
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
    vi.stubEnv('CENSUS_PERF_READINESS_TIMEOUT_MS', '45000');
    vi.resetModules();
    const {
      default: config,
      MEASURED_READINESS_MS,
      WARMUP_READINESS_MS,
    } = await import('../../../playwright.census-performance.config');
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
    expect(config.forbidOnly).toBe(true);
    expect(config.use).toMatchObject({
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
    });
    expect(MEASURED_READINESS_MS).toBe(45_000);
    expect(WARMUP_READINESS_MS).toBe(135_000);

    const censusSteps = ciJobs()['census-startup-performance'].steps;
    const measureStep = censusSteps.find(
      step => step.run === 'npm run test:e2e:census-performance'
    );
    expect(measureStep?.env?.CENSUS_PERF_INCLUDE_INTERACTIONS).toBe(
      "${{ matrix.environment == 'production' && '1' || '0' }}"
    );
    expect(
      censusSteps.some(step => step.run?.includes('npm run test:e2e:census-interactions'))
    ).toBe(false);
  });

  it('runs standalone production interactions via CENSUS_PERF_INTERACTIONS_ONLY', async () => {
    vi.stubEnv('CENSUS_PERF_ENV', 'production');
    vi.stubEnv('CENSUS_PERF_INTERACTIONS_ONLY', '1');
    vi.resetModules();
    const { default: config } = await import('../../../playwright.census-performance.config');
    expect(config.projects).toHaveLength(1);
    expect(config.projects?.[0]).toMatchObject({
      name: 'census-interactions-chromium',
      testMatch: 'census-interaction.measurement.ts',
      timeout: 180_000,
      outputDir: 'test-results/census-interactions',
    });
    expect(config.projects?.[0]?.dependencies).toBeUndefined();
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
