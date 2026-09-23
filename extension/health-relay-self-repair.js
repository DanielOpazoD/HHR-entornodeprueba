/** Repair orphaned relays detected by a health read, without opening new tabs. */
(function (root) {
  'use strict';

  const SOURCES = Object.freeze({
    fichaMedico: 'content-fichamedico.js',
    gestionCamas: 'content-gestioncamas.js',
    hhr: 'content-hhr.js',
  });

  const create = ({ repairRelay, publishHealth = () => undefined,
    now = () => Date.now(), cooldownMs = 30_000,
    log = (...args) => console.warn(...args) }) => {
    const pending = new Map();
    const lastUnconfirmed = new Map();
    const readyEpoch = new Map();

    const schedule = report => {
      for (const [source, relayFile] of Object.entries(SOURCES)) {
        const health = report?.[source];
        if (health?.status === 'ready') {
          readyEpoch.set(relayFile, (readyEpoch.get(relayFile) || 0) + 1);
          lastUnconfirmed.delete(relayFile);
          continue;
        }
        // An expired session or an incompatible MAIN reader is not a missing relay.
        if (health?.status !== 'stale' || health.reason !== 'relay_disconnected') continue;
        if (pending.has(relayFile)) continue;
        const current = now();
        if (current - (lastUnconfirmed.get(relayFile) ?? -Infinity) < cooldownMs) continue;
        const epoch = readyEpoch.get(relayFile) || 0;
        const markUnconfirmed = () => {
          if ((readyEpoch.get(relayFile) || 0) === epoch) lastUnconfirmed.set(relayFile, now());
        };
        const task = Promise.resolve().then(() => repairRelay(relayFile))
          .then(result => {
            markUnconfirmed();
            // A second probe can prove the first failure was transient. Publish that
            // recovered status too; an actual reinjection already publishes itself.
            if (result?.complete && result.injectedTabs === 0) return publishHealth();
            return undefined;
          })
          .catch(error => {
            markUnconfirmed();
            log('[HHR] No se pudo reparar el relé desconectado:', error);
          })
          .finally(() => pending.delete(relayFile));
        pending.set(relayFile, task);
      }
    };

    return Object.freeze({ schedule });
  };

  root.HhrHealthRelaySelfRepair = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
