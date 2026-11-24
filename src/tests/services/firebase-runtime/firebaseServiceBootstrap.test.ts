import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseOptions } from 'firebase/app';

// ── Mocks (vi.hoisted ensures availability inside hoisted vi.mock factories) ──

const {
  initializeAppMock,
  initializeAuthMock,
  getAuthMock,
  connectAuthEmulatorMock,
  setPersistenceMock,
  initializeFirestoreMock,
  connectFirestoreEmulatorMock,
  persistentLocalCacheMock,
  persistentMultipleTabManagerMock,
  persistentSingleTabManagerMock,
  parseEmulatorHostMock,
  shouldUseSingleTabFirestoreCacheMock,
} = vi.hoisted(() => ({
  initializeAppMock: vi.fn(() => ({ name: 'test-app' })),
  initializeAuthMock: vi.fn(() => ({ name: 'test-auth' })),
  getAuthMock: vi.fn(() => ({ name: 'test-auth' })),
  connectAuthEmulatorMock: vi.fn(),
  setPersistenceMock: vi.fn().mockResolvedValue(undefined),
  initializeFirestoreMock: vi.fn(() => ({ name: 'test-db' })),
  connectFirestoreEmulatorMock: vi.fn(),
  persistentLocalCacheMock: vi.fn((opts: unknown) => opts),
  persistentMultipleTabManagerMock: vi.fn(() => 'multi-tab'),
  persistentSingleTabManagerMock: vi.fn(() => 'single-tab'),
  parseEmulatorHostMock: vi.fn(),
  shouldUseSingleTabFirestoreCacheMock: vi.fn(() => false),
}));

vi.mock('firebase/app', () => ({
  initializeApp: initializeAppMock,
}));

vi.mock('firebase/auth', () => ({
  initializeAuth: initializeAuthMock,
  getAuth: getAuthMock,
  connectAuthEmulator: connectAuthEmulatorMock,
  setPersistence: setPersistenceMock,
  browserPopupRedirectResolver: { type: 'POPUP_REDIRECT_RESOLVER' },
  browserSessionPersistence: { type: 'SESSION' },
  inMemoryPersistence: { type: 'MEMORY' },
}));

vi.mock('firebase/firestore', () => ({
  initializeFirestore: initializeFirestoreMock,
  connectFirestoreEmulator: connectFirestoreEmulatorMock,
  persistentLocalCache: persistentLocalCacheMock,
  persistentMultipleTabManager: persistentMultipleTabManagerMock,
  persistentSingleTabManager: persistentSingleTabManagerMock,
}));

vi.mock('@/services/firebase-runtime/firebaseEnvironmentPolicy', () => ({
  parseEmulatorHost: parseEmulatorHostMock,
  shouldUseSingleTabFirestoreCache: shouldUseSingleTabFirestoreCacheMock,
}));

vi.mock('@/services/firebase-runtime/firebaseRuntimeLoggers', () => ({
  firebaseBootstrapLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  connectAuthEmulator,
  connectFirestoreEmulator,
  initializeFirebaseCore,
  initializeFirestoreService,
} from '@/services/firebase-runtime/firebaseServiceBootstrap';

// firebaseConfig.ts runs these steps in this order; the tests drive the same sequence.
const initializeFirebaseServices = async (config: FirebaseOptions) => {
  const core = await initializeFirebaseCore(config);
  return { ...core, ...(await initializeFirestoreService(core.app)) };
};

const connectFirebaseEmulators = async ({
  auth,
  db,
}: Parameters<typeof connectAuthEmulator>[0] & Parameters<typeof connectFirestoreEmulator>[0]) =>
  Promise.all([connectAuthEmulator({ auth }), connectFirestoreEmulator({ db })]);

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_CONFIG: FirebaseOptions = {
  apiKey: 'test-key',
  authDomain: 'test.firebaseapp.com',
  projectId: 'test-project',
  storageBucket: 'test.appspot.com',
  messagingSenderId: '111',
  appId: '1:111:web:aaa',
};

const setDevMode = (isDev: boolean) => {
  (import.meta.env as Record<string, unknown>).DEV = isDev;
};

// ── Tests ────────────────────────────────────────────────────────────

describe('firebaseServiceBootstrap', () => {
  const savedEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.assign(import.meta.env, savedEnv);
  });

  afterEach(() => {
    vi.useRealTimers();
    setDevMode(true);
  });

  // ── initializeFirebaseServices ───────────────────────────────────

  describe('initializeFirebaseServices', () => {
    it('returns { app, auth, db }', async () => {
      const result = await initializeFirebaseServices(TEST_CONFIG);

      expect(result).toHaveProperty('app');
      expect(result).toHaveProperty('auth');
      expect(result).toHaveProperty('db');
    });

    it('calls initializeApp with the provided config', async () => {
      await initializeFirebaseServices(TEST_CONFIG);
      expect(initializeAppMock).toHaveBeenCalledWith(TEST_CONFIG);
    });

    it('initializes Auth directly with tab-scoped session persistence and memory fallback', async () => {
      await initializeFirebaseServices(TEST_CONFIG);

      expect(initializeAuthMock).toHaveBeenCalledWith(
        { name: 'test-app' },
        {
          persistence: [{ type: 'SESSION' }, { type: 'MEMORY' }],
          popupRedirectResolver: { type: 'POPUP_REDIRECT_RESOLVER' },
        }
      );
      expect(getAuthMock).not.toHaveBeenCalled();
      expect(setPersistenceMock).not.toHaveBeenCalled();
    });

    it('connects the Auth emulator synchronously inside initializeFirebaseCore before any microtask yield', async () => {
      setDevMode(true);
      (import.meta.env as Record<string, string>).VITE_AUTH_EMULATOR_HOST = 'http://127.0.0.1:9099';
      connectAuthEmulatorMock.mockImplementationOnce((authInstance: Record<string, unknown>) => {
        authInstance.emulatorConfig = { host: '127.0.0.1', port: 9099 };
      });
      try {
        const core = await initializeFirebaseCore(TEST_CONFIG);
        await connectAuthEmulator({ auth: core.auth });

        expect(connectAuthEmulatorMock).toHaveBeenCalledTimes(1);
        expect(connectAuthEmulatorMock).toHaveBeenCalledWith(core.auth, 'http://127.0.0.1:9099');
      } finally {
        delete (import.meta.env as Record<string, string | undefined>).VITE_AUTH_EMULATOR_HOST;
      }
    });

    it('initializes Firestore with multi-tab manager by default', async () => {
      shouldUseSingleTabFirestoreCacheMock.mockReturnValue(false);

      await initializeFirebaseServices(TEST_CONFIG);

      expect(persistentMultipleTabManagerMock).toHaveBeenCalled();
      expect(persistentSingleTabManagerMock).not.toHaveBeenCalled();
    });

    it('uses single-tab manager when shouldUseSingleTabFirestoreCache returns true', async () => {
      shouldUseSingleTabFirestoreCacheMock.mockReturnValue(true);

      await initializeFirebaseServices(TEST_CONFIG);

      expect(persistentSingleTabManagerMock).toHaveBeenCalledWith({});
      expect(persistentMultipleTabManagerMock).not.toHaveBeenCalled();
    });

    it('falls back to basic Firestore when persistent cache init fails', async () => {
      initializeFirestoreMock
        .mockImplementationOnce(() => {
          throw new Error('IndexedDB not available');
        })
        .mockImplementationOnce(() => ({ name: 'test-db-fallback' }));

      const result = await initializeFirebaseServices(TEST_CONFIG);

      expect(initializeFirestoreMock).toHaveBeenCalledTimes(2);
      // Second call should NOT include localCache
      const secondCallArgs = initializeFirestoreMock.mock.calls[1] as unknown[];
      expect(secondCallArgs[1]).toEqual({ ignoreUndefinedProperties: true });
      expect(result.db).toEqual({ name: 'test-db-fallback' });
    });

    it('falls back to getAuth + awaited session persistence when initializeAuth throws', async () => {
      initializeAuthMock.mockImplementationOnce(() => {
        throw new Error('auth/already-initialized');
      });

      await initializeFirebaseServices(TEST_CONFIG);

      expect(getAuthMock).toHaveBeenCalledWith({ name: 'test-app' });
      expect(setPersistenceMock).toHaveBeenCalledWith({ name: 'test-auth' }, { type: 'SESSION' });
    });

    it('unblocks fallback bootstrap after timeout when session persistence stalls', async () => {
      initializeAuthMock.mockImplementationOnce(() => {
        throw new Error('auth/already-initialized');
      });
      setPersistenceMock.mockImplementationOnce(() => new Promise(() => {}));

      const servicesPromise = initializeFirebaseServices(TEST_CONFIG);
      await vi.advanceTimersByTimeAsync(1_500);
      const services = await servicesPromise;

      expect(services).toEqual({
        app: { name: 'test-app' },
        auth: { name: 'test-auth' },
        db: { name: 'test-db' },
      });
      expect(setPersistenceMock).toHaveBeenCalledTimes(1);
      expect(setPersistenceMock.mock.calls[0]?.[1]).toEqual({ type: 'SESSION' });
    });

    it('falls back to memory persistence when session persistence rejects', async () => {
      initializeAuthMock.mockImplementationOnce(() => {
        throw new Error('auth/already-initialized');
      });
      setPersistenceMock
        .mockRejectedValueOnce(new Error('session storage blocked'))
        .mockResolvedValueOnce(undefined);

      const services = await initializeFirebaseServices(TEST_CONFIG);

      expect(services).toEqual({
        app: { name: 'test-app' },
        auth: { name: 'test-auth' },
        db: { name: 'test-db' },
      });
      expect(setPersistenceMock).toHaveBeenCalledTimes(2);
      expect(setPersistenceMock.mock.calls[0]?.[1]).toEqual({ type: 'SESSION' });
      expect(setPersistenceMock.mock.calls[1]?.[1]).toEqual({ type: 'MEMORY' });
    });

    it('does not start memory fallback on timeout before the stalled session attempt settles', async () => {
      initializeAuthMock.mockImplementationOnce(() => {
        throw new Error('auth/already-initialized');
      });
      let rejectSession: ((error: Error) => void) | undefined;
      setPersistenceMock
        .mockImplementationOnce(
          () =>
            new Promise((_, reject: (error: Error) => void) => {
              rejectSession = reject;
            })
        )
        .mockResolvedValueOnce(undefined);

      const servicesPromise = initializeFirebaseServices(TEST_CONFIG);
      await vi.advanceTimersByTimeAsync(1_500);
      const services = await servicesPromise;

      expect(services).toEqual({
        app: { name: 'test-app' },
        auth: { name: 'test-auth' },
        db: { name: 'test-db' },
      });
      expect(setPersistenceMock).toHaveBeenCalledTimes(1);

      rejectSession?.(new Error('late session failure'));
      await vi.runAllTicks();
      await Promise.resolve();

      expect(setPersistenceMock).toHaveBeenCalledTimes(2);
      expect(setPersistenceMock.mock.calls[1]?.[1]).toEqual({ type: 'MEMORY' });
    });
  });

  // ── connectFirebaseEmulators ─────────────────────────────────────

  describe('connectFirebaseEmulators', () => {
    const mockAuth = { name: 'test-auth' } as unknown as Parameters<
      typeof connectFirebaseEmulators
    >[0]['auth'];
    const mockDb = { name: 'test-db' } as unknown as Parameters<
      typeof connectFirebaseEmulators
    >[0]['db'];

    it('connects auth emulator when VITE_AUTH_EMULATOR_HOST is set in DEV mode', async () => {
      setDevMode(true);
      (import.meta.env as Record<string, string>).VITE_AUTH_EMULATOR_HOST = 'http://localhost:9099';

      await connectFirebaseEmulators({ auth: mockAuth, db: mockDb });

      expect(connectAuthEmulatorMock).toHaveBeenCalledWith(mockAuth, 'http://localhost:9099');
    });

    it('connects firestore emulator when VITE_FIRESTORE_EMULATOR_HOST is set in DEV mode', async () => {
      setDevMode(true);
      (import.meta.env as Record<string, string>).VITE_FIRESTORE_EMULATOR_HOST = 'localhost:8080';
      parseEmulatorHostMock.mockReturnValue({ host: 'localhost', port: 8080 });

      await connectFirebaseEmulators({ auth: mockAuth, db: mockDb });

      expect(connectFirestoreEmulatorMock).toHaveBeenCalledWith(mockDb, 'localhost', 8080);
    });

    it('does NOT connect emulators when not in DEV mode', async () => {
      setDevMode(false);
      (import.meta.env as Record<string, string>).VITE_AUTH_EMULATOR_HOST = 'http://localhost:9099';
      (import.meta.env as Record<string, string>).VITE_FIRESTORE_EMULATOR_HOST = 'localhost:8080';

      await connectFirebaseEmulators({ auth: mockAuth, db: mockDb });

      expect(connectAuthEmulatorMock).not.toHaveBeenCalled();
      expect(connectFirestoreEmulatorMock).not.toHaveBeenCalled();
    });

    it('logs warning for invalid firestore emulator host format', async () => {
      setDevMode(true);
      (import.meta.env as Record<string, string>).VITE_FIRESTORE_EMULATOR_HOST = 'bad-format';
      parseEmulatorHostMock.mockReturnValue(null);

      const { firebaseBootstrapLogger } = vi.mocked(
        await import('@/services/firebase-runtime/firebaseRuntimeLoggers')
      );

      await connectFirebaseEmulators({ auth: mockAuth, db: mockDb });

      expect(firebaseBootstrapLogger.warn).toHaveBeenCalledWith(
        '[FirebaseConfig] Invalid Firestore emulator host:',
        'bad-format'
      );
    });

    it('does not connect auth emulator when env var is not set', async () => {
      setDevMode(true);
      delete (import.meta.env as Record<string, string | undefined>).VITE_AUTH_EMULATOR_HOST;
      delete (import.meta.env as Record<string, string | undefined>).VITE_FIRESTORE_EMULATOR_HOST;

      await connectFirebaseEmulators({ auth: mockAuth, db: mockDb });

      expect(connectAuthEmulatorMock).not.toHaveBeenCalled();
      expect(connectFirestoreEmulatorMock).not.toHaveBeenCalled();
    });
  });
});
