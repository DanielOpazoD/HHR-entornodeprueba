import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const SUPPORTED_E2E_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;

type SupportedE2eBrowser = (typeof SUPPORTED_E2E_BROWSERS)[number];
type PlaywrightProject = NonNullable<PlaywrightTestConfig['projects']>[number];

const isSupportedE2eBrowser = (browser: string): browser is SupportedE2eBrowser =>
  SUPPORTED_E2E_BROWSERS.includes(browser as SupportedE2eBrowser);

export const resolveConfiguredPlaywrightProjects = (
  browserList = process.env.E2E_BROWSERS || 'chromium'
) => {
  const configuredBrowsers = browserList
    .split(',')
    .map(browser => browser.trim().toLowerCase())
    .filter(Boolean);

  const unsupportedBrowsers = configuredBrowsers.filter(browser => !isSupportedE2eBrowser(browser));
  if (unsupportedBrowsers.length > 0) {
    throw new Error(
      `Unsupported E2E_BROWSERS value: ${unsupportedBrowsers.join(', ')}. Supported values: ${SUPPORTED_E2E_BROWSERS.join(', ')}`
    );
  }

  const selectedBrowsers =
    configuredBrowsers.length > 0
      ? configuredBrowsers
      : (['chromium'] satisfies SupportedE2eBrowser[]);

  const projects: PlaywrightProject[] = [];

  if (selectedBrowsers.includes('chromium')) {
    projects.push({
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    });
  }

  if (selectedBrowsers.includes('firefox')) {
    projects.push({
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    });
  }

  if (selectedBrowsers.includes('webkit')) {
    projects.push({
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    });
  }

  return projects;
};

const projects = resolveConfiguredPlaywrightProjects();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects,

  webServer: {
    command: 'VITE_E2E_MODE=true npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    env: {
      VITE_E2E_MODE: 'true',
    },
  },
});
