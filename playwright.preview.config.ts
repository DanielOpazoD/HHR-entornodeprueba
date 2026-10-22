import { defineConfig, devices } from '@playwright/test';

import { TEST_DEVICE_TIME_ZONE, pinTestTimeZone } from './scripts/config/testTimeZone';

pinTestTimeZone();

const previewCommand =
  process.env.PLAYWRIGHT_SKIP_PREVIEW_BUILD === '1'
    ? 'npm run preview -- --host 127.0.0.1 --port 4173'
    : 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173';
const previewArtifactsDir =
  process.env.PLAYWRIGHT_PREVIEW_ARTIFACTS_DIR || 'reports/e2e/preview-bootstrap';

// A CI lane runs one slice of the pack and leaves a blob; preview-smoke merges
// every lane into the canonical report through playwright.preview-merge.config.ts.
const previewLane = process.env.PLAYWRIGHT_PREVIEW_LANE;

const reporters = previewLane
  ? [
      ['list'],
      // Blob output is cleared per run, so each lane owns its directory.
      [
        'blob',
        {
          outputDir: `reports/e2e/preview-blobs/${previewLane}`,
          fileName: `preview-smoke-blob-${previewLane}.zip`,
        },
      ],
    ]
  : [
      ['list'],
      ['json', { outputFile: `${previewArtifactsDir}/report.json` }],
      ['junit', { outputFile: `${previewArtifactsDir}/report.junit.xml` }],
    ];

if (process.env.CI) {
  reporters.unshift(['github']);
  if (!previewLane) {
    reporters.push(['html', { open: 'never', outputFolder: `${previewArtifactsDir}/html` }]);
  }
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: reporters,
  use: {
    timezoneId: TEST_DEVICE_TIME_ZONE,
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: previewCommand,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
