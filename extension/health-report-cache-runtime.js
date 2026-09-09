/** Short-lived single-flight cache for expensive extension health probes. */
(function (root) {
  'use strict';

  const create = ({ readHealth, now = () => Date.now(), ttlMs = 3000 }) => {
    if (typeof readHealth !== 'function') {
      throw new Error('Falta el lector del estado de la extensión.');
    }
    let cachedReport = null;
    let cachedAt = 0;
    let inFlight = null;

    const invalidate = () => {
      cachedReport = null;
      cachedAt = 0;
    };

    const read = ({ force = false } = {}) => {
      const timestamp = now();
      if (!force && cachedReport && timestamp - cachedAt < ttlMs) {
        return Promise.resolve(cachedReport);
      }
      if (inFlight) return inFlight;
      inFlight = Promise.resolve()
        .then(readHealth)
        .then(report => {
          cachedReport = report;
          cachedAt = now();
          return report;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    };

    return Object.freeze({ read, invalidate });
  };

  root.HhrHealthReportCacheRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
