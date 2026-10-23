/** Short-lived single-flight cache for expensive extension health probes. */
(function (root) {
  'use strict';
  const create = ({ readHealth, now = () => Date.now(), ttlMs = 3000 }) => {
    if (typeof readHealth !== 'function') {
      throw new Error('Falta el lector del estado de la extensión.');
    }
    let cached = null;
    let inFlight = null;
    let revision = 0;
    const invalidate = () => {
      revision += 1;
      cached = null;
    };

    const read = ({ force = false, verifySessions = false } = {}) => {
      // Action probes invalidate passive work, including late replies from its old revision.
      if (verifySessions && (!inFlight || !inFlight.verifySessions)) invalidate();
      if (!force && !verifySessions && cached && now() - cached.at < ttlMs) {
        return Promise.resolve(cached.report);
      }
      if (inFlight && inFlight.revision === revision) return inFlight.promise;
      const request = { revision, verifySessions };
      request.promise = Promise.resolve()
        .then(() => readHealth(verifySessions ? { verifySessions: true } : undefined))
        .then(report => {
          if (request.revision === revision) cached = { report, at: now() };
          return report;
        })
        .finally(() => {
          if (inFlight === request) inFlight = null;
        });
      inFlight = request;
      return request.promise;
    };
    return Object.freeze({ read, invalidate });
  };

  root.HhrHealthReportCacheRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
