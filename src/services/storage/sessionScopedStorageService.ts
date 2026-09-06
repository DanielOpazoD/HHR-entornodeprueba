import { clearAllRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import { clearSyncQueueForOwner, recordSyncQueueOwnershipTelemetry } from '@/services/storage/sync';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import {
  getLogoutGeneration,
  getSessionGeneration,
  runSessionStorageTransition,
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from './sessionStorageTransition';

const SESSION_OWNER_KEY = 'hhr_session_owner_v1';
const CLEANUP_PENDING_KEY = 'hhr_session_cleanup_pending_v1';
let failedCleanupGeneration: string | null | undefined;
let pendingLocalAuthClosure: (() => Promise<void>) | undefined;

export const resolveSessionOwnerKey = (uid: string | null | undefined): string | null =>
  uid ? `user:${uid}` : null;

export const getStoredSessionOwnerKey = (): string | null => {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  return localStorage.getItem(SESSION_OWNER_KEY);
};

const setStoredSessionOwnerKey = (ownerKey: string | null): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  if (!ownerKey) {
    localStorage.removeItem(SESSION_OWNER_KEY);
    return;
  }

  localStorage.setItem(SESSION_OWNER_KEY, ownerKey);
};

/**
 * localStorage keys that must survive logout because they hold
 * infrastructure state unrelated to the authenticated user.
 * Everything else prefixed with `hhr_` is cleared on session end.
 *
 * Whitelist approach: new keys are cleaned automatically unless
 * explicitly preserved here.
 */
const KEYS_SURVIVING_LOGOUT = new Set([
  // Transition metadata is removed only after every cleanup step succeeds.
  SESSION_OWNER_KEY,
  SESSION_GENERATION_KEY,
  CLEANUP_PENDING_KEY,
  'hhr_app_version',
  'hhr_firebase_config',
  'hhr_diagnosis_mode',
  'hhr_storage_auto_recovery_attempted_v1',
  'hhr_storage_persistent_fallback_count_v1',
  'hhr_feature_flags',
  'hhr_chunk_reload_count',
]);

/** sessionStorage keys that must survive logout (bootstrap coordination). */
const SESSION_KEYS_SURVIVING_LOGOUT = new Set([
  'hhr_bootstrap_recovery_v1',
  'hhr_bootstrap_storage_repair_v1',
  'hhr_recent_manual_logout_v1',
]);

const clearUserScopedLocalStorage = (): void => {
  if (typeof localStorage === 'undefined') return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('hhr_') && !KEYS_SURVIVING_LOGOUT.has(key)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
};

const clearUserScopedSessionStorage = (): void => {
  if (typeof sessionStorage === 'undefined') return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith('hhr_') && !SESSION_KEYS_SURVIVING_LOGOUT.has(key)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => sessionStorage.removeItem(key));
};

const clearSensitiveSessionState = async (ownerKey: string | null): Promise<void> => {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => clearAllRecords({ throwOnError: true })),
    Promise.resolve().then(() => clearSyncQueueForOwner(ownerKey, true)),
    Promise.resolve().then(clearUserScopedLocalStorage),
    Promise.resolve().then(clearUserScopedSessionStorage),
  ]);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map(result => result.reason),
      'Session cleanup failed'
    );
};

export const reconcileAuthorizedSessionOwner = (ownerKey: string): Promise<void> =>
  runSessionStorageTransition(async () => {
    if (pendingLocalAuthClosure) {
      await pendingLocalAuthClosure();
      // The authorized event that initiated this admission predates the retried
      // sign-out. It must not reauthorize that same Firebase session.
      throw new Error('Previous session closed; authenticate again');
    }
    if (failedCleanupGeneration !== undefined) clearUserScopedSessionStorage();
    const previousOwnerKey = getStoredSessionOwnerKey();
    if (
      failedCleanupGeneration === localStorage.getItem(SESSION_GENERATION_KEY) ||
      localStorage.getItem(CLEANUP_PENDING_KEY) ||
      (previousOwnerKey && previousOwnerKey !== ownerKey)
    ) {
      localStorage.setItem(CLEANUP_PENDING_KEY, '1');
      await clearSensitiveSessionState(previousOwnerKey);
      localStorage.removeItem(CLEANUP_PENDING_KEY);
      localStorage.removeItem(SESSION_GENERATION_KEY);
    }
    setStoredSessionOwnerKey(ownerKey);
    const generation = localStorage.getItem(SESSION_GENERATION_KEY) || crypto.randomUUID();
    localStorage.setItem(SESSION_GENERATION_KEY, generation);
    setSessionGeneration(generation);
    failedCleanupGeneration = undefined;
    if (!previousOwnerKey || previousOwnerKey === ownerKey) return;
    recordSyncQueueOwnershipTelemetry('session_owner_changed', {
      previousOwnerKey,
      nextOwnerKey: ownerKey,
    });
    recordOperationalTelemetry({
      category: 'auth',
      operation: 'session_owner_changed_cleanup',
      status: 'degraded',
      runtimeState: 'recoverable',
      issues: [
        'Se limpió el estado local sensible al detectar un cambio de usuario en este navegador.',
      ],
      context: {
        previousOwnerKey,
        nextOwnerKey: ownerKey,
      },
    });
  });

export const clearSessionScopedClientState = (
  reason: 'manual' | 'automatic',
  closeLocalAuth: () => Promise<void> = async () => {},
  expectedGeneration: string | null = getLogoutGeneration()
): Promise<void> => {
  let authClosure: Promise<void> | undefined;
  const attemptLocalAuthClosure = async () => {
    try {
      await closeLocalAuth();
      pendingLocalAuthClosure = undefined;
    } catch (error) {
      pendingLocalAuthClosure = attemptLocalAuthClosure;
      throw error;
    }
  };
  const closeOnce = () => (authClosure ??= Promise.resolve().then(attemptLocalAuthClosure));
  return runSessionStorageTransition(async () => {
    // A queued logout from an older tab must not touch an admitted replacement.
    if (getSessionGeneration() && getSessionGeneration() !== expectedGeneration) return;
    let currentGeneration: string | null;
    let ownerKey: string | null;
    try {
      currentGeneration = localStorage.getItem(SESSION_GENERATION_KEY);
      ownerKey = getStoredSessionOwnerKey();
    } catch (error) {
      // Unverifiable shared ownership is not permission to erase another
      // document's data. Still attempt both document-local cleanup backends.
      await Promise.allSettled([
        closeOnce(),
        Promise.resolve().then(clearUserScopedSessionStorage),
      ]);
      throw error;
    }
    if (currentGeneration && currentGeneration !== expectedGeneration) {
      // Another document owns the new session. Close only this old document's
      // Firebase/sessionStorage copy, never the shared clinical stores.
      const localResults = await Promise.allSettled([
        closeOnce(),
        Promise.resolve().then(clearUserScopedSessionStorage),
      ]);
      const localFailures = localResults.filter(result => result.status === 'rejected');
      if (localFailures.length)
        throw new AggregateError(
          localFailures.map(result => result.reason),
          'Local session cleanup failed'
        );
      setSessionGeneration(null);
      return;
    }
    let metadataError: unknown;
    try {
      localStorage.setItem(CLEANUP_PENDING_KEY, '1');
    } catch (error) {
      metadataError = error;
    }
    const results = await Promise.allSettled([
      closeOnce(),
      // A second tab still needs its own sessionStorage/auth cleanup, but shared
      // records already cleared by the first tab need not be deleted again.
      ownerKey || currentGeneration || expectedGeneration === null
        ? clearSensitiveSessionState(ownerKey)
        : Promise.resolve().then(clearUserScopedSessionStorage),
    ]);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map(result => result.reason),
        'Session cleanup failed'
      );
    setStoredSessionOwnerKey(null);
    localStorage.removeItem(SESSION_GENERATION_KEY);
    localStorage.removeItem(CLEANUP_PENDING_KEY);
    setSessionGeneration(null);
    failedCleanupGeneration = undefined;
    if (metadataError) throw metadataError;
    recordSyncQueueOwnershipTelemetry('session_owner_cleared', {
      ownerKey,
      logoutReason: reason,
    });
    recordOperationalTelemetry({
      category: 'auth',
      operation: 'session_owner_cleared_cleanup',
      status: 'degraded',
      runtimeState: 'recoverable',
      issues: ['Se limpió el estado local sensible al cerrar sesión.'],
      context: {
        ownerKey,
        logoutReason: reason,
      },
    });
  }).catch(async error => {
    failedCleanupGeneration = expectedGeneration;
    recordOperationalTelemetry({
      category: 'auth',
      operation: 'session_cleanup_failed',
      status: 'failed',
      runtimeState: 'blocked',
      issues: ['La limpieza de la sesión quedó pendiente; no se confirma un cierre completo.'],
      context: { logoutReason: reason },
    });
    // Blocked Web Storage must not leave Firebase signed in. Admission still
    // fails closed until shared storage can be prepared successfully.
    await closeOnce().catch(() => undefined);
    throw error;
  });
};
