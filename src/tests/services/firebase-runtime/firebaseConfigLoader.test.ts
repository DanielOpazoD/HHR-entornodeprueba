import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const { readDevFirebaseApiKeyMock } = vi.hoisted(() => ({
  readDevFirebaseApiKeyMock: vi.fn(() => 'dev-api-key'),
}));

vi.mock('@/services/firebase-runtime/firebaseEnvironmentPolicy', () => ({
  readDevFirebaseApiKey: readDevFirebaseApiKeyMock,
}));

vi.mock('@/services/firebase-runtime/firebaseRuntimeLoggers', () => ({
  firebaseConfigLoaderLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Let safeJsonParse work normally — it is a pure utility
// vi.mock('@/utils/jsonUtils') — intentionally NOT mocked

import { loadFirebaseConfig } from '@/services/firebase-runtime/firebaseConfigLoader';

// ── Helpers ──────────────────────────────────────────────────────────

const VALID_CONFIG = {
  apiKey: 'prod-api-key',
  authDomain: 'proj.firebaseapp.com',
  projectId: 'proj',
  storageBucket: 'proj.appspot.com',
  messagingSenderId: '123',
  appId: '1:123:web:abc',
};

const CACHED_CONFIG_KEY = 'hhr_firebase_config';

const setDevMode = (isDev: boolean) => {
  (import.meta.env as Record<string, unknown>).DEV = isDev;
  (import.meta.env as Record<string, unknown>).PROD = !isDev;
};

// ── Tests ────────────────────────────────────────────────────────────

describe('firebaseConfigLoader – loadFirebaseConfig', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default env vars for DEV mode
    (import.meta.env as Record<string, string>).VITE_FIREBASE_API_KEY_B64 = '';
    (import.meta.env as Record<string, string>).VITE_FIREBASE_API_KEY = 'dev-plain-key';
    (import.meta.env as Record<string, string>).VITE_FIREBASE_AUTH_DOMAIN = 'dev.firebaseapp.com';
    (import.meta.env as Record<string, string>).VITE_FIREBASE_PROJECT_ID = 'dev-project';
    (import.meta.env as Record<string, string>).VITE_FIREBASE_STORAGE_BUCKET = 'dev.appspot.com';
    (import.meta.env as Record<string, string>).VITE_FIREBASE_MESSAGING_SENDER_ID = '999';
    (import.meta.env as Record<string, string>).VITE_FIREBASE_APP_ID = '1:999:web:dev';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setDevMode(true); // restore default vitest DEV=true
  });

  // ── DEV mode ─────────────────────────────────────────────────────

  describe('in DEV mode', () => {
    beforeEach(() => setDevMode(true));

    it('returns config built from env vars without fetching', async () => {
      readDevFirebaseApiKeyMock.mockReturnValue('dev-api-key');
      const config = await loadFirebaseConfig();

      expect(config.apiKey).toBe('dev-api-key');
      expect(config.projectId).toBe('dev-project');
      expect(readDevFirebaseApiKeyMock).toHaveBeenCalled();
    });
  });

  // ── PROD mode ────────────────────────────────────────────────────

  describe('in PROD mode', () => {
    beforeEach(() => setDevMode(false));

    it('returns cached config from localStorage and triggers background revalidation', async () => {
      localStorage.setItem(CACHED_CONFIG_KEY, JSON.stringify(VALID_CONFIG));

      // Mock fetch for background revalidation (fire-and-forget)
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(VALID_CONFIG),
      });
      globalThis.fetch = fetchMock;

      const config = await loadFirebaseConfig();

      expect(config).toEqual(VALID_CONFIG);
      // Background revalidation should have triggered a fetch asynchronously
      // Give the microtask queue a tick
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    it('fetches from Netlify function when no cached config exists', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(VALID_CONFIG),
      });
      globalThis.fetch = fetchMock;

      const config = await loadFirebaseConfig();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(config).toEqual(VALID_CONFIG);
      // Should be cached now
      const cached = JSON.parse(localStorage.getItem(CACHED_CONFIG_KEY) || 'null');
      expect(cached).toEqual(VALID_CONFIG);
    });

    it('consumes the preboot early config fetch without a second request', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
      (window as { __HHR_EARLY_CONFIG_FETCH__?: Promise<unknown> }).__HHR_EARLY_CONFIG_FETCH__ =
        Promise.resolve(VALID_CONFIG);

      const config = await loadFirebaseConfig();

      expect(config).toEqual(VALID_CONFIG);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        (window as { __HHR_EARLY_CONFIG_FETCH__?: Promise<unknown> }).__HHR_EARLY_CONFIG_FETCH__
      ).toBeUndefined();
      const cached = JSON.parse(localStorage.getItem(CACHED_CONFIG_KEY) || 'null');
      expect(cached).toEqual(VALID_CONFIG);
    });

    it('falls back to its own fetch when the preboot early config is unusable', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(VALID_CONFIG),
      });
      globalThis.fetch = fetchMock;
      (window as { __HHR_EARLY_CONFIG_FETCH__?: Promise<unknown> }).__HHR_EARLY_CONFIG_FETCH__ =
        Promise.resolve(null);

      const config = await loadFirebaseConfig();

      expect(config).toEqual(VALID_CONFIG);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws when Netlify function returns a non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      await expect(loadFirebaseConfig()).rejects.toThrow('Runtime config request failed (500)');
    });

    it('throws when response is missing required fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ projectId: 'proj' }), // missing apiKey, appId
      });

      await expect(loadFirebaseConfig()).rejects.toThrow('Runtime config response is incomplete');
    });

    it('ignores an invalid cached config and fetches fresh', async () => {
      // Cache something that fails hasRequiredFirebaseFields
      localStorage.setItem(CACHED_CONFIG_KEY, JSON.stringify({ projectId: 'only-this' }));

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(VALID_CONFIG),
      });
      globalThis.fetch = fetchMock;

      const config = await loadFirebaseConfig();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(config).toEqual(VALID_CONFIG);
    });
  });
});
