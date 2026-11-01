import { defineConfig } from '@playwright/test';
import accounts from './playwright.accounts.config';

// Standalone acceptance command; uses the existing hermetic account browser configuration.
export default defineConfig({
  ...accounts,
  testMatch: 'shared-computer-acceptance.spec.ts',
  timeout: 180_000,
  reporter: [['list'], ['json', { outputFile: 'reports/e2e/shared-computer/report.json' }]],
});
