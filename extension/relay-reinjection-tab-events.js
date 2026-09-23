/** Recover restored HHR/Eloísa tabs after the first MV3 startup scan. */
(function (root) {
  'use strict';
  const create = ({ chromeApi, operations, whenIdle, notify, log }) => {
    const { resolveRelay, matchesPattern } = root.HhrRelayReinjectionManifest.create(chromeApi);
    const restoredPatterns = [
      'content-fichamedico.js', 'content-gestioncamas.js', 'content-hhr.js',
    ].flatMap(file => resolveRelay(file)?.isolatedEntry.matches || []);
    const pending = new Map();
    const repairTab = tabId => {
      if (pending.has(tabId)) return pending.get(tabId);
      const task = (async () => {
        await whenIdle();
        const result = await operations.repairActivatedTab(tabId);
        if (result.injected) notify(1);
        return result;
      })().finally(() => pending.delete(tabId));
      pending.set(tabId, task);
      return task;
    };
    const start = () => {
      chromeApi.tabs?.onActivated?.addListener(({ tabId }) => {
        void repairTab(tabId).catch(error =>
          log('[HHR] No se pudo verificar la pestaña activa:', error)
        );
      });
      chromeApi.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
        if (changeInfo?.status !== 'complete' ||
            !restoredPatterns.some(pattern => matchesPattern(tab?.url, pattern))) return;
        void repairTab(tabId).catch(error =>
          log('[HHR] No se pudo verificar la pestaña restaurada:', error)
        );
      });
    };
    return { repairTab, start };
  };
  root.HhrRelayReinjectionTabEvents = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
