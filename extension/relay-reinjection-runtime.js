/** Session policy for bounded relay reinjection operations. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'hhrRelaysInjectedForSessionV1';
  const create = ({
    chromeApi, withTimeout, timeoutMs,
    onReinjected, log = (...args) => console.warn(...args),
  }) => {
    let pending = null;
    const operations = root.HhrRelayReinjectionOperations.create({
      chromeApi, withTimeout, timeoutMs, log,
    });
    const notify = count => {
      if (typeof onReinjected !== 'function') return;
      try {
        Promise.resolve(onReinjected(count)).catch(error =>
          log('[HHR] El aviso post-reinyección falló:', error)
        );
      } catch (error) {
        log('[HHR] El aviso post-reinyección falló:', error);
      }
    };
    const reinjectTab = async target => {
      const result = await operations.reinjectTab(target);
      if (result.injected) notify(1);
      return result;
    };
    const reinjectRelays = async () => {
      const result = await operations.reinjectRelays();
      if (result.injectedTabs) notify(result.injectedTabs);
      return result;
    };
    const reinjectRelay = async requiredFile => {
      const result = await operations.reinjectMatching(requiredFile);
      if (result.injectedTabs) notify(result.injectedTabs);
      return result;
    };
    const ensureReinjected = ({ force = false } = {}) => {
      if (pending) return pending;
      pending = (async () => {
        const session = chromeApi.storage?.session;
        const version = String(chromeApi.runtime.getManifest().version || 'unknown');
        if (!force && session) {
          const stored = await session.get(STORAGE_KEY).catch(() => ({}));
          if (stored?.[STORAGE_KEY] === version) return { injectedTabs: 0, skipped: true };
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
    const start = () => {
      if (!chromeApi.scripting || !chromeApi.runtime.onInstalled) return false;
      chromeApi.runtime.onInstalled.addListener(() => void ensureReinjected({ force: true }));
      void ensureReinjected();
      return true;
    };
    return { start, reinjectRelay, reinjectRelays, reinjectTab, ensureReinjected };
  };
  root.HhrRelayReinjectionRuntime = { create, STORAGE_KEY };
})(typeof self !== 'undefined' ? self : globalThis);
