import type { FirebaseOptions } from 'firebase/app';
import { safeJsonParse } from '@/utils/jsonUtils';
import { readDevFirebaseApiKey } from '@/services/firebase-runtime/firebaseEnvironmentPolicy';
import { firebaseConfigLoaderLogger } from '@/services/firebase-runtime/firebaseRuntimeLoggers';

const CACHED_CONFIG_KEY = 'hhr_firebase_config';

const hasRequiredFirebaseFields = (
  config: Partial<FirebaseOptions> | null
): config is FirebaseOptions =>
  Boolean(
    config &&
    String(config.apiKey || '').trim() &&
    String(config.projectId || '').trim() &&
    String(config.appId || '').trim()
  );

const saveCachedConfig = (config: FirebaseOptions) => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CACHED_CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    firebaseConfigLoaderLogger.info('[FirebaseConfig] Failed to cache Firebase config:', error);
  }
};

const getCachedConfig = (): FirebaseOptions | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CACHED_CONFIG_KEY);
    if (!raw) return null;
    const parsed = safeJsonParse<FirebaseOptions | null>(raw, null);
    if (hasRequiredFirebaseFields(parsed)) {
      return parsed;
    }
    localStorage.removeItem(CACHED_CONFIG_KEY);
    return null;
  } catch (error) {
    firebaseConfigLoaderLogger.info(
      '[FirebaseConfig] Failed to read cached Firebase config:',
      error
    );
    return null;
  }
};

const FETCH_TIMEOUT_MS = 8_000;

type EarlyConfigFetchWindow = Window & {
  __HHR_EARLY_CONFIG_FETCH__?: Promise<Partial<FirebaseOptions> | null>;
};

/**
 * Consumes the config request started by public/startup-surface.js on
 * first-visit production loads (no cached config). Starting that fetch at
 * preboot lets the Netlify Function cold start overlap bundle download/parse
 * instead of running serially after it.
 */
const consumeEarlyConfigFetch = async (): Promise<FirebaseOptions | null> => {
  if (typeof window === 'undefined') return null;
  const earlyWindow = window as EarlyConfigFetchWindow;
  const earlyFetch = earlyWindow.__HHR_EARLY_CONFIG_FETCH__;
  if (!earlyFetch) return null;
  delete earlyWindow.__HHR_EARLY_CONFIG_FETCH__;

  try {
    const timeoutFallback = new Promise<null>(resolve => {
      setTimeout(() => resolve(null), FETCH_TIMEOUT_MS);
    });
    const config = await Promise.race([earlyFetch, timeoutFallback]);
    return hasRequiredFirebaseFields(config ?? null) ? config : null;
  } catch (error) {
    firebaseConfigLoaderLogger.info('[FirebaseConfig] Early preboot config fetch failed:', error);
    return null;
  }
};

const fetchRuntimeConfig = async (): Promise<FirebaseOptions> => {
  const configUrl = `/.netlify/functions/firebase-config?t=${Date.now()}&mode=recovery`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(configUrl, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Runtime config request failed (${response.status})`);
    }

    const config = (await response.json()) as Partial<FirebaseOptions>;
    if (!hasRequiredFirebaseFields(config)) {
      throw new Error('Runtime config response is incomplete');
    }

    return config satisfies FirebaseOptions;
  } finally {
    clearTimeout(timeout);
  }
};

const buildDevConfig = (): FirebaseOptions => {
  const encodedKey = import.meta.env.VITE_FIREBASE_API_KEY_B64 || '';
  const plainKey = import.meta.env.VITE_FIREBASE_API_KEY || '';

  firebaseConfigLoaderLogger.info('Checking environment variables', {
    hasApiKey: !!plainKey,
    hasB64Key: !!encodedKey,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    mode: import.meta.env.MODE,
  });

  return {
    apiKey: readDevFirebaseApiKey(),
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  } satisfies FirebaseOptions;
};

/**
 * Revalidates the Firebase config from the Netlify Function in the background.
 * Errors are logged but never thrown — this is fire-and-forget.
 */
const revalidateConfigInBackground = (): void => {
  fetchRuntimeConfig()
    .then(fresh => {
      saveCachedConfig(fresh);
    })
    .catch(error => {
      firebaseConfigLoaderLogger.info(
        '[FirebaseConfig] Background config revalidation failed (non-blocking)',
        error
      );
    });
};

/**
 * Loads Firebase config using a cache-first strategy:
 * 1. If a valid cached config exists in localStorage, return it immediately
 *    and revalidate from the Netlify Function in the background.
 * 2. If no cache exists (first visit), fetch from the Netlify Function (blocking).
 *
 * This eliminates the 5-10s cold-start delay of the Netlify Function on
 * subsequent page loads and after logout+refresh.
 */
export const loadFirebaseConfig = async (): Promise<FirebaseOptions> => {
  if (import.meta.env.DEV) {
    return buildDevConfig();
  }

  // Cache-first: return cached config immediately if available
  const cached = getCachedConfig();
  if (cached) {
    revalidateConfigInBackground();
    return cached;
  }

  // No cache (first visit): prefer the fetch already started at preboot,
  // falling back to a fresh blocking fetch.
  const earlyConfig = await consumeEarlyConfigFetch();
  if (earlyConfig) {
    saveCachedConfig(earlyConfig);
    return earlyConfig;
  }

  const config = await fetchRuntimeConfig();
  saveCachedConfig(config);
  return config;
};
