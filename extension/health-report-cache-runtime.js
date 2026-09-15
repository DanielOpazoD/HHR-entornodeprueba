/** Short-lived single-flight cache for expensive extension health probes. */
(function (root) {
  'use strict';
  const create = ({ readHealth, now = () => Date.now(), ttlMs = 3000 }) => {
    if (typeof readHealth !== 'function') {
      throw new Error('Falta el lector del estado de la extensión.');
    }
    let cachedReport = null;
    let cachedAt = 0;
    let inFlight = null; let revision = 0;

    const invalidate = () => {
      revision += 1;
      cachedReport = null; cachedAt = 0;
    };

    const read = ({ force = false } = {}) => {
      const timestamp = now();
      if (!force && cachedReport && timestamp - cachedAt < ttlMs) {
        return Promise.resolve(cachedReport);
      }
      if (inFlight && inFlight.revision === revision) return inFlight.promise;
      const readRevision = revision;
      const promise = Promise.resolve()
        .then(readHealth)
        .then(report => {
          if (readRevision === revision) {
            cachedReport = report; cachedAt = now();
          }
          return report;
        })
        .finally(() => { if (inFlight && inFlight.promise === promise) inFlight = null; });
      inFlight = { revision: readRevision, promise };
      return promise;
    };

    return Object.freeze({ read, invalidate });
  };

  root.HhrHealthReportCacheRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
