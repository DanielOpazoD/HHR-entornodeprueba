import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Shared by the prebuilt preview and the Playwright-owned development server.
 * @returns {Record<string, string | undefined>}
 */
export const buildCriticalE2EEnvironment = (parent = process.env) => {
  const host = parent.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const authHost = parent.FIREBASE_AUTH_EMULATOR_HOST;
  for (const endpoint of [host, ...(authHost ? [authHost] : [])]) {
    const match = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(endpoint);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) {
      throw new Error('Critical E2E requires loopback emulator endpoints with valid ports.');
    }
  }
  // Blank inherited frontend values even when Playwright merges this map with process.env.
  // Toolchain variables remain available to the child command.
  const environment = Object.fromEntries(
    Object.entries(parent).map(([key, value]) => [key, key.startsWith('VITE_') ? '' : value])
  );
  return {
    ...environment,
    VITE_E2E_MODE: 'true',
    VITE_FIREBASE_API_KEY: 'demo-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'demo-hhr.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'demo-hhr-e2e',
    VITE_FIREBASE_STORAGE_BUCKET: 'demo-hhr-e2e.firebasestorage.app',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
    VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef123456',
    VITE_FIRESTORE_EMULATOR_HOST: host,
    VITE_AUTH_EMULATOR_HOST: authHost ? `http://${authHost}` : '',
    VITE_GOOGLE_SIGN_IN_CLIENT_ID: '',
    VITE_SYSLAB_ENABLE_DIRECT_LOCAL: 'true',
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('A command is required for the isolated E2E environment.');
  const result = spawnSync(command, args, { stdio: 'inherit', env: buildCriticalE2EEnvironment() });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
