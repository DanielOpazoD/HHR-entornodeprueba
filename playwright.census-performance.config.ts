import { defineConfig, devices } from '@playwright/test';

const environment = process.env.CENSUS_PERF_ENV ?? 'production';
if (!['development', 'production'].includes(environment))
  throw new Error('Invalid CENSUS_PERF_ENV');
export default defineConfig({
  testDir: './e2e',
  testMatch: 'census-startup.measurement.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  forbidOnly: true,
  timeout: 900_000,
  expect: { timeout: 20_000 },
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
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'census-performance-chromium' }],
  webServer: {
    command: `node scripts/census-startup-performance-server.mjs ${environment}`,
    url: 'http://127.0.0.1:4318',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
