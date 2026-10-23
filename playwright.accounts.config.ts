import { defineConfig, devices } from '@playwright/test';
const project = 'demo-hhr-nursing-accounts';
for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || ''))
    throw new Error('Local account emulators required');
}
export default defineConfig({
  testDir: './e2e',
  testMatch: 'nursing-private-accounts.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list'], ['json', { outputFile: 'reports/e2e/nursing-accounts/report.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4184',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4184 --strictPort',
    url: 'http://127.0.0.1:4184',
    reuseExistingServer: false,
    env: {
      VITE_E2E_MODE: 'false',
      VITE_FIREBASE_API_KEY: 'synthetic-key',
      VITE_FIREBASE_PROJECT_ID: project,
      VITE_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`,
      VITE_FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`,
      VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
      VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef123456',
      VITE_AUTH_EMULATOR_HOST: `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,
      VITE_FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST!,
      VITE_GOOGLE_SIGN_IN_CLIENT_ID: '',
      VITE_FUNCTIONS_EMULATOR_HOST: '',
    },
  },
});
