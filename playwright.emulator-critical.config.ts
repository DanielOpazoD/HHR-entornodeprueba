import { defineConfig, devices } from '@playwright/test';
import { buildCriticalE2EEnvironment } from './scripts/config/criticalE2EEnvironment.mjs';

import { TEST_DEVICE_TIME_ZONE, pinTestTimeZone } from './scripts/config/testTimeZone';

pinTestTimeZone();

process.env.E2E_FIXED_DATE ||= '2026-02-20';

// Default: vite dev. For release-accurate measurements (flow-performance
// spec), set PLAYWRIGHT_USE_PREVIEW=1 to use the production build served
// by vite preview. PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 reuses an existing
// dist/ directory — cuts ~45 s off re-runs.
const usePreviewMode = process.env.PLAYWRIGHT_USE_PREVIEW === '1';
const skipPreviewBuild = process.env.PLAYWRIGHT_SKIP_PREVIEW_BUILD === '1';
const webServerHost = '127.0.0.1';
const defaultWebServerPort = usePreviewMode ? '4173' : '3100';
const webServerPort = Number.parseInt(
  process.env.PLAYWRIGHT_WEB_SERVER_PORT || defaultWebServerPort,
  10
);
const webServerOrigin = `http://${webServerHost}:${webServerPort}`;
const previewCommand = skipPreviewBuild
  ? `npm run preview -- --host ${webServerHost} --port ${webServerPort} --strictPort`
  : `npm run build && npm run preview -- --host ${webServerHost} --port ${webServerPort} --strictPort`;
const webServerCommand = usePreviewMode
  ? previewCommand
  : `npm run dev -- --host ${webServerHost} --port ${webServerPort} --strictPort`;
const jsonReporterOutput = process.env.PLAYWRIGHT_JSON_OUTPUT;
const reporter = jsonReporterOutput
  ? [
      ...(process.env.CI ? ([['github']] as const) : []),
      ['html', { open: 'never' }],
      [
        'json',
        {
          outputFile: jsonReporterOutput,
        },
      ],
    ]
  : process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        [
          'json',
          {
            outputFile: 'reports/e2e/playwright-report.json',
          },
        ],
      ]
    : 'html';

const baseEnv = buildCriticalE2EEnvironment();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter,
  timeout: 45_000,

  use: {
    timezoneId: TEST_DEVICE_TIME_ZONE,
    baseURL: webServerOrigin,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: ((): Array<{ name: string; use: object }> => {
    const configuredBrowsers = (process.env.E2E_CRITICAL_BROWSERS || 'chromium')
      .split(',')
      .map(browser => browser.trim().toLowerCase())
      .filter(Boolean);

    const projects: Array<{ name: string; use: object }> = [];
    if (configuredBrowsers.includes('chromium')) {
      projects.push({
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      });
    }
    if (configuredBrowsers.includes('firefox')) {
      projects.push({
        name: 'firefox',
        use: { ...devices['Desktop Firefox'] },
      });
    }

    // Keep at least Chromium so local runs never end up with zero projects.
    if (projects.length === 0) {
      projects.push({
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      });
    }
    return projects;
  })(),

  webServer: {
    command: webServerCommand,
    url: webServerOrigin,
    reuseExistingServer: false,
    env: baseEnv,
    // Preview mode needs extra headroom for the vite build step before
    // the server starts accepting connections.
    timeout: usePreviewMode && !skipPreviewBuild ? 240_000 : 120_000,
  },
});
