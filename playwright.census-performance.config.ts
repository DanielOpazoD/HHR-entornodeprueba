import { defineConfig, devices } from '@playwright/test';

const environment = process.env.CENSUS_PERF_ENV ?? 'production';
const includeInteractions = process.env.CENSUS_PERF_INCLUDE_INTERACTIONS === '1';
if (includeInteractions && environment !== 'production')
  throw new Error('Combined census measurements require production');
// Observation waits, NOT performance budgets. A bench must be able to record a slow
// startup; failing by timeout would hide the very slowness it exists to quantify.
// Verdicts still come from p95 vs scripts/config/flow-performance-budgets.json.
const readinessMs = Number(process.env.CENSUS_PERF_READINESS_TIMEOUT_MS ?? 60_000);
if (!Number.isInteger(readinessMs) || readinessMs < 20_000)
  throw new Error('CENSUS_PERF_READINESS_TIMEOUT_MS must be an integer >= 20000');
const samples = Number(process.env.CENSUS_PERF_SAMPLES ?? 30);
if (!Number.isInteger(samples) || samples < 1) throw new Error('Invalid CENSUS_PERF_SAMPLES');
// One-time dev-server compilation is absorbed by the excluded warmup navigation.
export const WARMUP_READINESS_MS = readinessMs * 3;
export const MEASURED_READINESS_MS = readinessMs;
if (!['development', 'production'].includes(environment))
  throw new Error('Invalid CENSUS_PERF_ENV');
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  forbidOnly: true,
  timeout: WARMUP_READINESS_MS + (2 * samples + 1) * readinessMs,
  expect: { timeout: readinessMs },
  reporter: [['list']],
  outputDir: 'test-results/census-performance',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: process.env.CENSUS_PERF_EXECUTABLE_PATH
      ? { executablePath: process.env.CENSUS_PERF_EXECUTABLE_PATH }
      : undefined,
    baseURL: 'http://127.0.0.1:4318',
    timezoneId: 'Pacific/Easter',
    locale: 'es-CL',
    serviceWorkers: 'block',
    // Synthetic fixture only: these artifacts contain no real patients or credentials,
    // and without them a failed run leaves nothing to diagnose.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  // One fresh build/server for both projects; dependencies preserve startup first.
  projects: [
    { name: 'census-performance-chromium', testMatch: 'census-startup.measurement.ts' },
    ...(includeInteractions
      ? [
          {
            name: 'census-interactions-chromium',
            testMatch: 'census-interaction.measurement.ts',
            dependencies: ['census-performance-chromium'],
            timeout: 180_000,
            expect: { timeout: 5000 },
            outputDir: 'test-results/census-interactions',
          },
        ]
      : []),
  ],
  webServer: {
    command: `node scripts/census-startup-performance-server.mjs ${environment}`,
    url: 'http://127.0.0.1:4318',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
