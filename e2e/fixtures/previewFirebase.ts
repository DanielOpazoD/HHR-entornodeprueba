import fs from 'node:fs';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';

export type FirebasePreviewConfig = {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
};

const parseDotEnvFile = (filePath: string): Record<string, string> => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .reduce<Record<string, string>>((acc, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        return acc;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        return acc;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
};

export const loadPreviewFirebaseConfig = (): FirebasePreviewConfig => {
  const envFiles = ['.env.production', '.env', '.env.local'].map(file =>
    path.resolve(process.cwd(), file)
  );
  const mergedEnv = envFiles.reduce<Record<string, string>>(
    (acc, filePath) => ({ ...acc, ...parseDotEnvFile(filePath) }),
    {}
  );

  const apiKey =
    process.env.VITE_FIREBASE_API_KEY || mergedEnv.VITE_FIREBASE_API_KEY || 'demo-api-key';
  const projectId =
    process.env.VITE_FIREBASE_PROJECT_ID || mergedEnv.VITE_FIREBASE_PROJECT_ID || 'demo-hhr-e2e';
  const appId =
    process.env.VITE_FIREBASE_APP_ID ||
    mergedEnv.VITE_FIREBASE_APP_ID ||
    '1:1234567890:web:abcdef123456';

  return {
    apiKey,
    authDomain:
      process.env.VITE_FIREBASE_AUTH_DOMAIN ||
      mergedEnv.VITE_FIREBASE_AUTH_DOMAIN ||
      'demo-hhr.firebaseapp.com',
    projectId,
    storageBucket:
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      mergedEnv.VITE_FIREBASE_STORAGE_BUCKET ||
      'demo-hhr-e2e.firebasestorage.app',
    messagingSenderId:
      process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
      mergedEnv.VITE_FIREBASE_MESSAGING_SENDER_ID ||
      '1234567890',
    appId,
  };
};

export const installPreviewFirebaseRuntime = async (page: Page) => {
  const firebaseConfig = loadPreviewFirebaseConfig();

  await page.route('**/.netlify/functions/firebase-config**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(firebaseConfig),
    });
  });

  await page.addInitScript(
    ({ runtimeConfig }: { runtimeConfig: FirebasePreviewConfig }) => {
      // Playwright also runs init scripts inside the browser's isolated PDF frames.
      if (window !== window.top || !/^https?:$/.test(location.protocol)) return;
      localStorage.setItem('hhr_firebase_config', JSON.stringify(runtimeConfig));
    },
    { runtimeConfig: firebaseConfig }
  );

  return firebaseConfig;
};
