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
  __HHR_EARLY_CONFIG_FETCH__?:
    | Promise<Partial<FirebaseOptions> | null>
    | {
        startedAt: number;
        promise: Promise<Partial<FirebaseOptions> | null>;
      };
};

type EarlyConfigFetchOutcome = {
  config: FirebaseOptions | null;
  remainingMs: number;
};

const isLegacyEarlyConfigPromise = (
  value: EarlyConfigFetchWindow['__HHR_EARLY_CONFIG_FETCH__']
): value is Promise<Partial<FirebaseOptions> | null> =>
  typeof (value as { then?: unknown } | undefined)?.then === 'function';

/**
 * Consumes the config request started by public/startup-surface.js on
 * first-visit production loads (no cached config). Starting that fetch at
 * preboot lets the Netlify Function cold start overlap bundle download/parse
 * instead of running serially after it.
 */
const consumeEarlyConfigFetch = async (): Promise<EarlyConfigFetchOutcome> => {
  if (typeof window === 'undefined') {
    return { config: null, remainingMs: FETCH_TIMEOUT_MS };
  }
  const earlyWindow = window as EarlyConfigFetchWindow;
  const earlyFetch = earlyWindow.__HHR_EARLY_CONFIG_FETCH__;
  if (!earlyFetch) {
    return { config: null, remainingMs: FETCH_TIMEOUT_MS };
  }
  delete earlyWindow.__HHR_EARLY_CONFIG_FETCH__;

  // During a rolling deploy the HTML/startup script can be one version behind
  // the application bundle. The former preboot contract stored a bare Promise;
  // accept it with a fresh local budget instead of breaking first-load auth.
  const normalizedEarlyFetch = isLegacyEarlyConfigPromise(earlyFetch)
    ? { startedAt: Date.now(), promise: earlyFetch }
    : earlyFetch;

  const remainingBudget = () =>
    Math.max(0, FETCH_TIMEOUT_MS - Math.max(0, Date.now() - normalizedEarlyFetch.startedAt));

  try {
    const initialRemainingMs = remainingBudget();
    if (initialRemainingMs === 0) {
      // Do not wait beyond the shared budget, but still consume a preboot
      // request that already completed while the bundle was downloading or
      // the tab was suspended. A still-pending request loses immediately.
      const settledConfig = await Promise.race([
        normalizedEarlyFetch.promise,
        Promise.resolve(null),
      ]);
      return {
        config: hasRequiredFirebaseFields(settledConfig ?? null) ? settledConfig : null,
        remainingMs: 0,
      };
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutFallback = new Promise<null>(resolve => {
      timeoutId = setTimeout(() => resolve(null), initialRemainingMs);
    });
    try {
      const config = await Promise.race([normalizedEarlyFetch.promise, timeoutFallback]);
      return {
        config: hasRequiredFirebaseFields(config ?? null) ? config : null,
        remainingMs: remainingBudget(),
      };
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  } catch (error) {
    firebaseConfigLoaderLogger.info('[FirebaseConfig] Early preboot config fetch failed:', error);
    return { config: null, remainingMs: remainingBudget() };
  }
};

const fetchRuntimeConfig = async (timeoutMs = FETCH_TIMEOUT_MS): Promise<FirebaseOptions> => {
  if (timeoutMs <= 0) {
    throw new Error('Runtime config request timed out');
  }
  const configUrl = `/.netlify/functions/firebase-config?t=${Date.now()}&mode=recovery`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
  const earlyConfigOutcome = await consumeEarlyConfigFetch();
  if (earlyConfigOutcome.config) {
    saveCachedConfig(earlyConfigOutcome.config);
    return earlyConfigOutcome.config;
  }

  const config = await fetchRuntimeConfig(earlyConfigOutcome.remainingMs);
  saveCachedConfig(config);
  return config;
};
