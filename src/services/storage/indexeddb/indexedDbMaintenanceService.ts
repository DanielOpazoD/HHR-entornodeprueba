import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { clearIndexedDatabases } from '@/services/storage/indexeddb/indexedDbDeleteController';

const canUseWindow = (): boolean => typeof window !== 'undefined';
const APP_STORAGE_PREFIXES = ['hhr_', 'hanga_roa_', 'indexeddb_'];
const APP_STORAGE_KEYS = new Set(['offlineQueue']);

/**
 * What the automatic startup repair must never remove: every local store of clinical work that has
 * not reached the server yet, and the one-attempt markers that stop the repair from looping.
 * Literals so storage does not depend on its owners; the maintenance tests pin them to the owners'
 * constants.
 */
export const DATABASES_KEPT_BY_AUTOMATIC_REPAIR = ['HangaRoaDB'] as const; // sync queue + records
export const STORAGE_KEYS_KEPT_BY_AUTOMATIC_REPAIR = new Set([
  'offlineQueue', // legacy offline queue
  'hhr_pending_daily_record_patches_v1', // PENDING_DAILY_RECORD_PATCH_STORAGE_KEY
  'hhr_bootstrap_storage_repair_v1', // bootstrap repair marker (sessionStorage)
  'hhr_bootstrap_recovery_v1', // client bootstrap recovery marker (sessionStorage)
]);
export const STORAGE_PREFIXES_KEPT_BY_AUTOMATIC_REPAIR = [
  'hhr_audit_connection_outbox_v1:', // AUDIT_CONNECTION_OUTBOX_PREFIX
] as const;

const isKeptByAutomaticRepair = (key: string): boolean =>
  STORAGE_KEYS_KEPT_BY_AUTOMATIC_REPAIR.has(key) ||
  STORAGE_PREFIXES_KEPT_BY_AUTOMATIC_REPAIR.some(prefix => key.startsWith(prefix));

interface ClearBrowserStorageOptions {
  preserveFirebaseAuth?: boolean;
  clearAll?: boolean;
  keep?: (key: string) => boolean;
}

const clearStorageBucket = (storage: Storage, options: ClearBrowserStorageOptions = {}): void => {
  if (options.clearAll) {
    storage.clear();
    return;
  }

  const keysToRemove: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) {
      continue;
    }

    if (
      options.preserveFirebaseAuth &&
      (key.startsWith('firebase:authUser:') || key.startsWith('firebase:redirectUser:'))
    ) {
      continue;
    }

    if (options.keep?.(key)) {
      continue;
    }

    if (APP_STORAGE_KEYS.has(key) || APP_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    storage.removeItem(key);
  }
};

const clearBrowserStorage = (options: ClearBrowserStorageOptions = {}): void => {
  if (!canUseWindow()) return;

  clearStorageBucket(localStorage, options);
  clearStorageBucket(sessionStorage, options);
};

const unregisterServiceWorkers = async (): Promise<void> => {
  if (!canUseWindow() || !('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_unregister_service_workers', error, {
      code: 'indexeddb_unregister_service_workers_failed',
      message: 'No fue posible desregistrar service workers locales.',
      severity: 'warning',
      userSafeMessage: 'No fue posible limpiar service workers del navegador.',
    });
  }
};

const clearCacheStorage = async (): Promise<void> => {
  if (!canUseWindow() || !('caches' in window)) return;

  try {
    const cacheNames = await window.caches.keys();
    await Promise.all(cacheNames.map(cacheName => window.caches.delete(cacheName)));
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_clear_cache_storage', error, {
      code: 'indexeddb_clear_cache_storage_failed',
      message: 'No fue posible limpiar caches locales del navegador.',
      severity: 'warning',
      userSafeMessage: 'No fue posible limpiar algunos caches locales del navegador.',
    });
  }
};

export const resetLocalDatabase = async (): Promise<void> => {
  await clearIndexedDatabases();
  clearBrowserStorage({ preserveFirebaseAuth: true });
  defaultBrowserWindowRuntime.reload();
};

/**
 * The one repair the bootstrap runs on its own when Firebase cannot start. It clears what the
 * browser rebuilds by itself (service workers, Cache Storage, Firebase's own databases, app
 * caches in storage) and keeps the stores of unsynced clinical work and the repair markers, so a
 * failure that survives the repair stops at the blocked screen instead of repairing again.
 */
export const repairClientStorageKeepingPendingWork = async (): Promise<void> => {
  await unregisterServiceWorkers();
  await clearCacheStorage();
  clearBrowserStorage({ preserveFirebaseAuth: true, keep: isKeptByAutomaticRepair });
  await clearIndexedDatabases(DATABASES_KEPT_BY_AUTOMATIC_REPAIR);
  defaultBrowserWindowRuntime.reload();
};

export const resetLocalAppStorage = async (): Promise<void> => {
  await unregisterServiceWorkers();
  await clearCacheStorage();
  clearBrowserStorage({ clearAll: true });
  await clearIndexedDatabases();
  defaultBrowserWindowRuntime.reload();
};
