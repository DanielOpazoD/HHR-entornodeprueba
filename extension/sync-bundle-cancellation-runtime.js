/**
 * sync-bundle-cancellation-runtime.js (extension — importScripts in the SW, require() in tests)
 *
 * HHR cancels a capture when the operator changes the date or leaves mid-run. The tab-side
 * census read cannot be interrupted cheaply, but the worker must not finish the job for a
 * client that already moved on: the capture is skipped when the cancel arrived first, its
 * result is dropped when it arrived meanwhile, and the relay silences the `cancelled` reply.
 */
(function (root) {
  'use strict';

  const CANCELLED_MESSAGE = 'Sincronización cancelada desde HHR.';
  const MAX_TRACKED = 32;

  const create = () => {
    const cancelled = new Set();
    const isValid = requestId => typeof requestId === 'string' && requestId.length > 0;
    const cancel = requestId => {
      if (!isValid(requestId)) return { ok: false };
      cancelled.add(requestId);
      while (cancelled.size > MAX_TRACKED) cancelled.delete(cancelled.values().next().value);
      return { ok: true };
    };
    const isCancelled = requestId => cancelled.has(requestId);
    const release = requestId => cancelled.delete(requestId);
    const cancelledResult = () => ({ error: CANCELLED_MESSAGE, cancelled: true });
    /** Runs one capture unless it was cancelled before or while it ran. */
    const run = async (requestId, capture) => {
      if (isCancelled(requestId)) {
        release(requestId);
        return cancelledResult();
      }
      try {
        const result = await capture();
        return isCancelled(requestId) ? cancelledResult() : result;
      } finally {
        release(requestId);
      }
    };
    return Object.freeze({ cancel, isCancelled, release, run });
  };

  root.HhrSyncBundleCancellationRuntime = Object.freeze({ CANCELLED_MESSAGE, MAX_TRACKED, create });
})(typeof self !== 'undefined' ? self : globalThis);
