import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';

// ── Mocks ────────────────────────────────────────────────────────────

const { getStorageMock, getFunctionsMock, connectFunctionsEmulatorMock, parseEmulatorHostMock } =
  vi.hoisted(() => ({
    getStorageMock: vi.fn(() => ({ name: 'test-storage' })),
    getFunctionsMock: vi.fn(() => ({ name: 'test-functions' })),
    connectFunctionsEmulatorMock: vi.fn(),
    parseEmulatorHostMock: vi.fn(),
  }));

vi.mock('firebase/storage', () => ({
  getStorage: getStorageMock,
}));

vi.mock('firebase/functions', () => ({
  getFunctions: getFunctionsMock,
  connectFunctionsEmulator: connectFunctionsEmulatorMock,
}));

vi.mock('@/services/firebase-runtime/firebaseEnvironmentPolicy', () => ({
  parseEmulatorHost: parseEmulatorHostMock,
}));

vi.mock('@/services/firebase-runtime/firebaseRuntimeLoggers', () => ({
  firebaseLazyServicesLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  createFirebaseLazyServicesState,
  resolveStorageInstance,
  resolveFunctionsInstance,
  resolveRegionalFunctionsInstance,
} from '@/services/firebase-runtime/firebaseLazyServices';

// ── Helpers ──────────────────────────────────────────────────────────

const mockApp = { name: 'test-app' } as unknown as FirebaseApp;

const setDevMode = (isDev: boolean) => {
  (import.meta.env as Record<string, unknown>).DEV = isDev;
};

// ── Tests ────────────────────────────────────────────────────────────

describe('firebaseLazyServices', () => {
  const savedEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(import.meta.env, savedEnv);
  });

  afterEach(() => {
    setDevMode(true);
    vi.restoreAllMocks();
  });

  // ── createFirebaseLazyServicesState ──────────────────────────────

  describe('createFirebaseLazyServicesState', () => {
    it('returns fresh state with undefined storage and functions', () => {
      const state = createFirebaseLazyServicesState();

      expect(state.storage).toBeUndefined();
      expect(state.functions).toBeUndefined();
      expect(state.functionsEmulatorConnected).toBe(false);
    });

    it('returns a new object on each call', () => {
      const a = createFirebaseLazyServicesState();
      const b = createFirebaseLazyServicesState();
      expect(a).not.toBe(b);
    });
  });

  describe.each(['default', 'regional'] as const)('%s Functions offline recovery', region => {
    const resolve = (state: ReturnType<typeof createFirebaseLazyServicesState>) =>
      region === 'default'
        ? resolveFunctionsInstance(mockApp, state)
        : resolveRegionalFunctionsInstance(mockApp, state, 'southamerica-east1');

    it('rejects offline with a retryable network code and recovers without replacing state', async () => {
      setDevMode(false);
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const state = createFirebaseLazyServicesState();

      const unavailable = await resolve(state).catch((error: unknown) => error);
      expect(unavailable).toMatchObject({ code: 'functions/unavailable' });
      expect(classifySyncError(unavailable)).toMatchObject({
        category: 'network',
        retryable: true,
      });
      expect(getFunctionsMock).not.toHaveBeenCalled();

      online.mockReturnValue(true);
      await expect(resolve(state)).resolves.toEqual({ name: 'test-functions' });
      expect(getFunctionsMock).toHaveBeenCalledTimes(1);

      // A previously initialized instance must also stop callers before their SDK import.
      online.mockReturnValue(false);
      await expect(resolve(state)).rejects.toMatchObject({ code: 'functions/unavailable' });
      online.mockReturnValue(true);
      await expect(resolve(state)).resolves.toEqual({ name: 'test-functions' });
      expect(getFunctionsMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── resolveStorageInstance ───────────────────────────────────────

  describe('resolveStorageInstance', () => {
    it('dynamically imports firebase/storage and returns the instance', async () => {
      const state = createFirebaseLazyServicesState();
      const storage = await resolveStorageInstance(mockApp, state);

      expect(getStorageMock).toHaveBeenCalledWith(mockApp);
      expect(storage).toEqual({ name: 'test-storage' });
    });

    it('caches the instance on second call', async () => {
      const state = createFirebaseLazyServicesState();

      const first = await resolveStorageInstance(mockApp, state);
      const second = await resolveStorageInstance(mockApp, state);

      expect(first).toBe(second);
      expect(getStorageMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── resolveFunctionsInstance ─────────────────────────────────────

  describe('resolveFunctionsInstance', () => {
    it('dynamically imports firebase/functions and returns the instance', async () => {
      setDevMode(false);
      const state = createFirebaseLazyServicesState();
      const fns = await resolveFunctionsInstance(mockApp, state);

      expect(getFunctionsMock).toHaveBeenCalledWith(mockApp);
      expect(fns).toEqual({ name: 'test-functions' });
    });

    it('caches the instance on second call', async () => {
      setDevMode(false);
      const state = createFirebaseLazyServicesState();

      const first = await resolveFunctionsInstance(mockApp, state);
      const second = await resolveFunctionsInstance(mockApp, state);

      expect(first).toBe(second);
      expect(getFunctionsMock).toHaveBeenCalledTimes(1);
    });

    it('connects to emulator in DEV mode when VITE_FUNCTIONS_EMULATOR_HOST is set', async () => {
      setDevMode(true);
      (import.meta.env as Record<string, string>).VITE_FUNCTIONS_EMULATOR_HOST = 'localhost:5001';
      parseEmulatorHostMock.mockReturnValue({ host: 'localhost', port: 5001 });

      const state = createFirebaseLazyServicesState();
      await resolveFunctionsInstance(mockApp, state);

      expect(connectFunctionsEmulatorMock).toHaveBeenCalledWith(
        { name: 'test-functions' },
        'localhost',
        5001
      );
      expect(state.functionsEmulatorConnected).toBe(true);
    });

    it('does not connect emulator twice', async () => {
      setDevMode(true);
      (import.meta.env as Record<string, string>).VITE_FUNCTIONS_EMULATOR_HOST = 'localhost:5001';
      parseEmulatorHostMock.mockReturnValue({ host: 'localhost', port: 5001 });

      const state = createFirebaseLazyServicesState();
      await resolveFunctionsInstance(mockApp, state);
      await resolveFunctionsInstance(mockApp, state);

      expect(connectFunctionsEmulatorMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT connect emulator when not in DEV mode', async () => {
      setDevMode(false);
      (import.meta.env as Record<string, string>).VITE_FUNCTIONS_EMULATOR_HOST = 'localhost:5001';

      const state = createFirebaseLazyServicesState();
      await resolveFunctionsInstance(mockApp, state);

      expect(connectFunctionsEmulatorMock).not.toHaveBeenCalled();
    });

    it('logs warning and skips emulator for invalid host format', async () => {
      setDevMode(true);
      (import.meta.env as Record<string, string>).VITE_FUNCTIONS_EMULATOR_HOST = 'bad-host';
      parseEmulatorHostMock.mockReturnValue(null);

      const { firebaseLazyServicesLogger } = vi.mocked(
        await import('@/services/firebase-runtime/firebaseRuntimeLoggers')
      );

      const state = createFirebaseLazyServicesState();
      const fns = await resolveFunctionsInstance(mockApp, state);

      expect(firebaseLazyServicesLogger.warn).toHaveBeenCalledWith(
        '[FirebaseConfig] Invalid functions emulator host:',
        'bad-host'
      );
      expect(connectFunctionsEmulatorMock).not.toHaveBeenCalled();
      // Still returns the functions instance
      expect(fns).toEqual({ name: 'test-functions' });
      expect(state.functionsEmulatorConnected).toBe(false);
    });

    it('does not try emulator when VITE_FUNCTIONS_EMULATOR_HOST is not set in DEV', async () => {
      setDevMode(true);
      delete (import.meta.env as Record<string, string | undefined>).VITE_FUNCTIONS_EMULATOR_HOST;

      const state = createFirebaseLazyServicesState();
      await resolveFunctionsInstance(mockApp, state);

      expect(parseEmulatorHostMock).not.toHaveBeenCalled();
      expect(connectFunctionsEmulatorMock).not.toHaveBeenCalled();
    });
  });
});
