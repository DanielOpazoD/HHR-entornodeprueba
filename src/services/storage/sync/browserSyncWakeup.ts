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
