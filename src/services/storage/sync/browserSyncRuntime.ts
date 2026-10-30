import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { startBrowserSyncWakeup } from './browserSyncWakeup';
import type { SyncRuntimePort } from '@/services/storage/sync/syncQueuePorts';
import {
  getStoredSessionOwnerKey,
  hasSessionCleanupFailed,
  isSessionCleanupPending,
} from '@/services/storage/sessionOwnerKey';

export const createBrowserSyncRuntime = (): SyncRuntimePort => {
  let onlineListenerRegistered = false;

  return {
    isOnline: () => typeof navigator !== 'undefined' && navigator.onLine,
    onOnline: callback => {
      if (onlineListenerRegistered) return;
      if (typeof window === 'undefined') return;

      const stop = startBrowserSyncWakeup(
        callback,
        () =>
          navigator.onLine && Boolean(getStoredSessionOwnerKey()) && Boolean(getSessionGeneration())
      );
      import.meta.hot?.dispose(stop);
      onlineListenerRegistered = true;
    },
    getOwnerKey: () => getStoredSessionOwnerKey(),
    // A pending cleanup only fences a document not yet admitted: admission completes it, and a tab
    // already admitted must not stall on one left by another tab that was closed mid-logout.
    isFenced: () =>
      hasSessionCleanupFailed() || (!getSessionGeneration() && isSessionCleanupPending()),
  };
};
