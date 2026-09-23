/** Session policy for bounded relay reinjection operations. */
(function (root) {
  'use strict';
  const create = ({
    chromeApi, withTimeout, timeoutMs,
    onReinjected, log = (...args) => console.warn(...args),
  }) => {
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
    const { ensureReinjected, whenIdle } = root.HhrRelayReinjectionSession.create({
      chromeApi, operations, reinjectRelays, notify, log,
    });
    const repairActivatedTab = async tabId => {
      await whenIdle();
      const result = await operations.repairActivatedTab(tabId);
      if (result.injected) notify(1);
      return result;
    };
    const start = () => {
      if (!chromeApi.scripting || !chromeApi.runtime.onInstalled) return false;
      chromeApi.runtime.onInstalled.addListener(() => void ensureReinjected({ force: true }));
      chromeApi.tabs?.onActivated?.addListener(({ tabId }) => {
        void repairActivatedTab(tabId).catch(error =>
          log('[HHR] No se pudo verificar la pestaña activa:', error)
        );
      });
      void ensureReinjected();
      return true;
    };
    return { start, reinjectRelay, reinjectRelays, reinjectTab, ensureReinjected, repairActivatedTab };
  };
  root.HhrRelayReinjectionRuntime = { create, STORAGE_KEY: root.HhrRelayReinjectionSession.STORAGE_KEY };
})(typeof self !== 'undefined' ? self : globalThis);
