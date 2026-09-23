/** Serialize startup and update repairs without trusting a stale session marker. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'hhrRelaysInjectedForSessionV1';
  const create = ({ chromeApi, operations, reinjectRelays, notify, log }) => {
    let pending = null;
    let forcedPending = null;
    const ensureReinjected = ({ force = false } = {}) => {
      if (pending) {
        if (!force) return pending;
        // An update/reload must not be swallowed by the in-flight startup check.
        if (!forcedPending) {
          forcedPending = pending.then(() => ensureReinjected({ force: true }))
            .finally(() => { forcedPending = null; });
        }
        return forcedPending;
      }
      pending = (async () => {
        const session = chromeApi.storage?.session;
        const version = String(chromeApi.runtime.getManifest().version || 'unknown');
        if (!force && session) {
          const stored = await session.get(STORAGE_KEY).catch(() => ({}));
          if (stored?.[STORAGE_KEY] === version) {
            const checked = await operations.repairMissingRelays();
            if (checked.injectedTabs) notify(checked.injectedTabs);
            return { ...checked, skipped: checked.injectedTabs === 0 && checked.complete };
          }
        }
        const result = await reinjectRelays();
        if (session && result.complete) {
          await session.set({ [STORAGE_KEY]: version }).catch(error =>
            log('[HHR] No se pudo registrar la re-inyección de esta sesión:', error)
          );
        }
        return { ...result, skipped: false };
      })().finally(() => { pending = null; });
      return pending;
    };
    const whenIdle = async () => {
      const running = forcedPending || pending;
      if (running) await running.catch(() => {});
    };
    return { ensureReinjected, whenIdle };
  };
  root.HhrRelayReinjectionSession = Object.freeze({ create, STORAGE_KEY });
})(typeof self !== 'undefined' ? self : globalThis);
