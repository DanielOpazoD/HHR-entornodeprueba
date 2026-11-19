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
  local: 2_500,
  session: 1_500,
  memory: 500,
} as const;

const getErrorMessage = (error: unknown): string =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);

type FirebaseAuthRuntimeModule = Pick<
  typeof import('firebase/auth'),
  | 'browserLocalPersistence'
  | 'browserSessionPersistence'
  | 'connectAuthEmulator'
  | 'inMemoryPersistence'
  | 'setPersistence'
>;

const startAuthPersistenceConfiguration = (
  auth: Auth,
  authRuntime: FirebaseAuthRuntimeModule
): void => {
  const persistenceCandidates = [
    { mode: 'local' as const, persistence: authRuntime.browserLocalPersistence },
    { mode: 'session' as const, persistence: authRuntime.browserSessionPersistence },
    { mode: 'memory' as const, persistence: authRuntime.inMemoryPersistence },
  ];

  const attemptCandidate = (index: number): void => {
    const candidate = persistenceCandidates[index];
    if (!candidate) {
      firebaseBootstrapLogger.warn('[FirebaseConfig] Auth persistence could not be configured', {
        mode: 'unconfigured',
      });
      return;
    }

    const timeoutMs = AUTH_PERSISTENCE_TIMEOUTS_MS[candidate.mode];
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      firebaseBootstrapLogger.info(
        `[FirebaseConfig] ⚠️ Auth persistence (${candidate.mode}) failed`,
        {
          message: `Auth persistence (${candidate.mode}) timed out after ${timeoutMs}ms`,
          mode: candidate.mode,
        }
      );
    }, timeoutMs);

    void authRuntime
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
        attemptCandidate(index + 1);
      });
  };

  attemptCandidate(0);
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
  const auth = authRuntime.getAuth(app);

  startAuthPersistenceConfiguration(auth, authRuntime);
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
