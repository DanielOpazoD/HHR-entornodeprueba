import { defineConfig, devices } from '@playwright/test';

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

const baseEnv = {
  VITE_E2E_MODE: 'true',
  E2E_FIXED_DATE: process.env.E2E_FIXED_DATE,
  VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-hhr.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || 'demo-hhr-e2e',
  VITE_FIREBASE_STORAGE_BUCKET:
    process.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-hhr-e2e.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1234567890',
  VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID || '1:1234567890:web:abcdef123456',
  VITE_FIRESTORE_EMULATOR_HOST: process.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
  VITE_SYSLAB_ENABLE_DIRECT_LOCAL: process.env.VITE_SYSLAB_ENABLE_DIRECT_LOCAL || 'true',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter,
  timeout: 45_000,

  use: {
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
    reuseExistingServer: !process.env.CI,
    env: baseEnv,
    // Preview mode needs extra headroom for the vite build step before
    // the server starts accepting connections.
    timeout: usePreviewMode && !skipPreviewBuild ? 240_000 : 120_000,
  },
});
