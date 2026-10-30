/** localStorage key of the signed-in owner whose local data and sync queue this browser holds. */
export const SESSION_OWNER_KEY = 'hhr_session_owner_v1';

/**
 * Owner of the local data and sync queue in this browser, as last admitted. A leaf module on
 * purpose: the sync runtime reads it without importing the session cleanup service, which itself
 * depends on the sync queue.
 */
export const getStoredSessionOwnerKey = (): string | null =>
  typeof localStorage === 'undefined' ? null : localStorage.getItem(SESSION_OWNER_KEY);

/** localStorage key set while a session's local cleanup is unfinished, or failed and must retry. */
export const SESSION_CLEANUP_PENDING_KEY = 'hhr_session_cleanup_pending_v1';

/** While set, the queue may no longer match the stored days: nothing publishes or confirms. */
export const isSessionCleanupPending = (): boolean =>
  typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(SESSION_CLEANUP_PENDING_KEY));
