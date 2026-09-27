import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'census-interaction.measurement.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  outputDir: 'test-results/census-interactions',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4318',
    timezoneId: 'Pacific/Easter',
    locale: 'es-CL',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'census-interactions-chromium' }],
  webServer: {
    command: 'node scripts/census-startup-performance-server.mjs production',
    url: 'http://127.0.0.1:4318',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
