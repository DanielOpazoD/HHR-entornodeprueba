import type { Page, Route } from '@playwright/test';

export type FirebasePreviewConfig = {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
};

const SYNTHETIC_PREVIEW_FIREBASE_CONFIG: FirebasePreviewConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'demo-hhr.firebaseapp.com',
  projectId: 'demo-hhr-e2e',
  storageBucket: 'demo-hhr-e2e.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef123456',
};

const isSyntheticProjectId = (projectId: string | undefined): projectId is string =>
  typeof projectId === 'string' && projectId.startsWith('demo-');

/**
 * Preview E2E runs strictly against synthetic `demo-*` Firebase coordinates.
 * Local `.env*` files and non-demo `VITE_FIREBASE_*` variables are ignored so tests
 * never point at production Firebase even when developer credentials exist on disk.
 */
export const loadPreviewFirebaseConfig = (
  env: Record<string, string | undefined> = process.env
): FirebasePreviewConfig => {
  const configuredProjectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (!isSyntheticProjectId(configuredProjectId)) {
    return { ...SYNTHETIC_PREVIEW_FIREBASE_CONFIG };
  }

  return {
    apiKey: env.VITE_FIREBASE_API_KEY?.trim() || SYNTHETIC_PREVIEW_FIREBASE_CONFIG.apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || `${configuredProjectId}.firebaseapp.com`,
    projectId: configuredProjectId,
    storageBucket:
      env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || `${configuredProjectId}.firebasestorage.app`,
    messagingSenderId:
      env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ||
      SYNTHETIC_PREVIEW_FIREBASE_CONFIG.messagingSenderId,
    appId: env.VITE_FIREBASE_APP_ID?.trim() || SYNTHETIC_PREVIEW_FIREBASE_CONFIG.appId,
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
