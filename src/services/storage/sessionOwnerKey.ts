/** localStorage key of the signed-in owner whose local data and sync queue this browser holds. */
export const SESSION_OWNER_KEY = 'hhr_session_owner_v1';

/**
 * Owner of the local data and sync queue in this browser, as last admitted. A leaf module on
 * purpose: the sync runtime reads it without importing the session cleanup service, which itself
 * depends on the sync queue.
 */
export const getStoredSessionOwnerKey = (): string | null =>
  typeof localStorage === 'undefined' ? null : localStorage.getItem(SESSION_OWNER_KEY);

/** Set in localStorage while a logout cleanup is unfinished; the next admission completes it. */
export const SESSION_CLEANUP_PENDING_KEY = 'hhr_session_cleanup_pending_v1';

export const isSessionCleanupPending = (): boolean =>
  typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(SESSION_CLEANUP_PENDING_KEY));

let sessionCleanupFailed = false;

/**
 * This document's own logout cleanup failed and has not succeeded on retry. Its queue may no longer
 * match the stored days, so its worker stands down. Kept in memory on purpose: it cannot outlive the
 * document or stop another tab, whose session may be healthy.
 */
export const hasSessionCleanupFailed = (): boolean => sessionCleanupFailed;
export const setSessionCleanupFailed = (failed: boolean): void => {
  sessionCleanupFailed = failed;
};
