import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import {
  parseEmulatorHost,
  shouldUseSingleTabFirestoreCache,
} from '@/services/firebase-runtime/firebaseEnvironmentPolicy';
import { firebaseBootstrapLogger } from '@/services/firebase-runtime/firebaseRuntimeLoggers';

export interface FirebaseBootstrapResult {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

export interface FirebaseCoreBootstrapResult {
  app: FirebaseApp;
  auth: Auth;
}

const AUTH_PERSISTENCE_TIMEOUTS_MS = {
  session: 1_500,
  memory: 500,
} as const;

const getErrorMessage = (error: unknown): string =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);

type FirebaseAuthRuntimeModule = Pick<
  typeof import('firebase/auth'),
  | 'browserSessionPersistence'
  | 'connectAuthEmulator'
  | 'getAuth'
  | 'inMemoryPersistence'
  | 'setPersistence'
> &
  Partial<Pick<typeof import('firebase/auth'), 'browserPopupRedirectResolver' | 'initializeAuth'>>;

const configureAuthPersistence = async (
  auth: Auth,
  authRuntime: FirebaseAuthRuntimeModule
): Promise<void> => {
  const persistenceCandidates = [
    { mode: 'session' as const, persistence: authRuntime.browserSessionPersistence },
    { mode: 'memory' as const, persistence: authRuntime.inMemoryPersistence },
  ];

  const attemptCandidate = async (index: number): Promise<void> => {
    const candidate = persistenceCandidates[index];
    if (!candidate) {
      firebaseBootstrapLogger.warn('[FirebaseConfig] Auth persistence could not be configured', {
        mode: 'unconfigured',
      });
      return;
    }

    const timeoutMs = AUTH_PERSISTENCE_TIMEOUTS_MS[candidate.mode];
    let didTimeout = false;
    let resolveTimeout: (() => void) | undefined;
    const timeoutPromise = new Promise<void>(resolve => {
      resolveTimeout = resolve;
    });
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      firebaseBootstrapLogger.info(
        `[FirebaseConfig] ⚠️ Auth persistence (${candidate.mode}) failed`,
        {
          message: `Auth persistence (${candidate.mode}) timed out after ${timeoutMs}ms`,
          mode: candidate.mode,
        }
      );
      resolveTimeout?.();
    }, timeoutMs);

    const persistencePromise = authRuntime
      .setPersistence(auth, candidate.persistence)
      .then(() => {
        clearTimeout(timeoutId);
        firebaseBootstrapLogger.info('Auth persistence configured', {
          persistenceMode: candidate.mode,
          settledAfterTimeout: didTimeout,
        });
      })
      .catch(error => {
        clearTimeout(timeoutId);
        firebaseBootstrapLogger.info(
          `[FirebaseConfig] ⚠️ Auth persistence (${candidate.mode}) failed`,
          {
            message: getErrorMessage(error),
            mode: candidate.mode,
            settledAfterTimeout: didTimeout,
          }
        );
        return attemptCandidate(index + 1);
      });

    await Promise.race([persistencePromise, timeoutPromise]);
  };

  await attemptCandidate(0);
};

const connectAuthEmulatorSync = (auth: Auth, authRuntime: FirebaseAuthRuntimeModule): void => {
  const authEmulatorHost = import.meta.env.VITE_AUTH_EMULATOR_HOST;
  if (import.meta.env.DEV && authEmulatorHost && !auth.emulatorConfig) {
    authRuntime.connectAuthEmulator(auth, authEmulatorHost);
  }
};

export const initializeFirebaseCore = async (
  config: FirebaseOptions
): Promise<FirebaseCoreBootstrapResult> => {
  firebaseBootstrapLogger.info('Initializing Firebase core');
  const [{ initializeApp }, authRuntime] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ]);

  const app = initializeApp(config);

  // Initialize Auth directly with tab-scoped session persistence (falling back
  // to in-memory if sessionStorage is blocked). This ensures closing the tab
  // closes the session while F5 reloads preserve the session and permissions
  // without racing against setPersistence or reading legacy localStorage/IDB.
  if (typeof authRuntime.initializeAuth === 'function') {
    try {
      const auth = authRuntime.initializeAuth(app, {
        persistence: [authRuntime.browserSessionPersistence, authRuntime.inMemoryPersistence],
        ...(authRuntime.browserPopupRedirectResolver
          ? { popupRedirectResolver: authRuntime.browserPopupRedirectResolver }
          : {}),
      });
      // Wire the Auth emulator synchronously before yielding a microtask:
      // browserSessionPersistence reads sessionStorage immediately and can
      // trigger token refresh (locking _canInitEmulator) on the very next tick.
      connectAuthEmulatorSync(auth, authRuntime);
      firebaseBootstrapLogger.info('Auth persistence configured', {
        persistenceMode: 'session',
      });
      firebaseBootstrapLogger.info('Firebase core ready');
      return { app, auth };
    } catch (error) {
      firebaseBootstrapLogger.info('[FirebaseConfig] Falling back to getAuth persistence setup', {
        message: getErrorMessage(error),
      });
    }
  }

  const auth = authRuntime.getAuth(app);
  connectAuthEmulatorSync(auth, authRuntime);
  await configureAuthPersistence(auth, authRuntime);
  firebaseBootstrapLogger.info('Firebase core ready');
  return { app, auth };
};

export const initializeFirestoreService = async (
  app: FirebaseApp
): Promise<Pick<FirebaseBootstrapResult, 'db'>> => {
  firebaseBootstrapLogger.info('Initializing Firestore runtime');
  const firestoreRuntime = await import('firebase/firestore');

  let db: Firestore;
  try {
    const useSingleTabCache = shouldUseSingleTabFirestoreCache();
    db = firestoreRuntime.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: firestoreRuntime.persistentLocalCache({
        tabManager: useSingleTabCache
          ? firestoreRuntime.persistentSingleTabManager({})
          : firestoreRuntime.persistentMultipleTabManager(),
      }),
    });
    firebaseBootstrapLogger.info('Firestore initialized', {
      cacheMode: useSingleTabCache ? 'single-tab' : 'multi-tab',
      persistenceRequested: true,
    });
  } catch (fsErr) {
    firebaseBootstrapLogger.info(
      '[FirebaseConfig] ⚠️ Firestore persistence failed at init:',
      fsErr
    );
    db = firestoreRuntime.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
    });
  }

  firebaseBootstrapLogger.info('Firestore runtime ready');
  return { db };
};

export const connectAuthEmulator = async ({ auth }: Pick<FirebaseBootstrapResult, 'auth'>) => {
  if (auth.emulatorConfig) {
    return;
  }

  const authEmulatorHost = import.meta.env.VITE_AUTH_EMULATOR_HOST;
  const authRuntime = await import('firebase/auth');

  if (import.meta.env.DEV && authEmulatorHost) {
    authRuntime.connectAuthEmulator(auth, authEmulatorHost);
  }
};

export const connectFirestoreEmulator = async ({ db }: Pick<FirebaseBootstrapResult, 'db'>) => {
  const firestoreEmulatorHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST;
  const firestoreRuntime = await import('firebase/firestore');

  if (import.meta.env.DEV && firestoreEmulatorHost) {
    const emulatorHost = parseEmulatorHost(firestoreEmulatorHost);
    if (emulatorHost) {
      firestoreRuntime.connectFirestoreEmulator(db, emulatorHost.host, emulatorHost.port);
    } else {
      firebaseBootstrapLogger.warn(
        '[FirebaseConfig] Invalid Firestore emulator host:',
        firestoreEmulatorHost
      );
    }
  }
};
