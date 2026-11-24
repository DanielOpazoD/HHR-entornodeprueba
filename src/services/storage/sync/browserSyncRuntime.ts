import { getSessionGeneration, getSessionOwner } from '@/services/session/sessionStorageTransition';
import type { SyncRuntimePort } from '@/services/storage/sync/syncQueuePorts';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import {
  hasSessionCleanupFailed,
  isSessionCleanupPending,
} from '@/services/session/sessionOwnerKey';
import { getTabOwnerKey } from '@/services/session/authoringSession';

/** Wake the existing outbox worker, not a second retry policy. IndexedDB claims,
 * nextAttemptAt, leases and quarantine remain authoritative in the engine/store. */
export const SYNC_QUEUE_WAKE_INTERVAL_MS = 30_000;

export const startBrowserSyncWakeup = (
  callback: () => void,
  canRun: () => boolean
): (() => void) => {
  const wake = () => {
    if (canRun()) callback();
  };
  const visible = () => {
    if (document.visibilityState === 'visible') wake();
  };
  const timer = window.setInterval(wake, SYNC_QUEUE_WAKE_INTERVAL_MS);
  const initial = window.setTimeout(wake, 0);
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.clearInterval(timer);
    window.clearTimeout(initial);
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wake);
    document.removeEventListener('visibilitychange', visible);
  };
};

export const createBrowserSyncRuntime = (): SyncRuntimePort => {
  let onlineListenerRegistered = false;

  return {
    isOnline: () => typeof navigator !== 'undefined' && navigator.onLine,
    onOnline: callback => {
      if (onlineListenerRegistered) return;
      if (typeof window === 'undefined') return;

      const stop = startBrowserSyncWakeup(
        callback,
        () => navigator.onLine && Boolean(getTabOwnerKey()) && Boolean(getSessionGeneration())
      );
      import.meta.hot?.dispose(stop);
      onlineListenerRegistered = true;
    },
    // Every queue exit (enqueue, send, revive, discard, release, the panel) acts only for the
    // person this tab admitted: another person's tasks stay as they are.
    getOwnerKey: getTabOwnerKey,
    getSessionGeneration,
    getAdmittedOwnerKey: () => getSessionOwner(),
    getActorKey: () => {
      const uid = defaultAuthRuntime.getCurrentUser()?.uid;
      return uid ? `user:${uid}` : null;
    },
    // A pending cleanup only fences a document not yet admitted: admission completes it, and a tab
    // already admitted must not stall on one left by another tab that was closed mid-logout.
    isFenced: () =>
      hasSessionCleanupFailed() || (!getSessionGeneration() && isSessionCleanupPending()),
    // A failed token read throws: the queue logs it and asks again on its next pass.
    getWriterRole: async () => {
      const role = (await defaultAuthRuntime.getCurrentUser()?.getIdTokenResult())?.claims.role;
      return typeof role === 'string' ? role : null;
    },
  };
};
