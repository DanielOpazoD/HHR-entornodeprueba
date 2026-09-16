/** Reconnect orphaned ISOLATED relays after an MV3 update or reload. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'hhrRelaysInjectedForSessionV1';
  const create = ({ chromeApi, onReinjected, log = (...args) => console.warn(...args) }) => {
    let pending = null;
    const reinjectRelays = async () => {
      const entries = (chromeApi.runtime.getManifest().content_scripts || []).filter(
        entry => entry.world !== 'MAIN' && Array.isArray(entry.js) && entry.js.length
      );
      let injectedTabs = 0;
      let failedTabs = 0;
      for (const entry of entries) {
        let tabs;
        try {
          tabs = await chromeApi.tabs.query({ url: entry.matches || [] });
        } catch (error) {
          failedTabs += 1;
          log('[HHR] No se pudieron enumerar pestañas para re-inyección:', error);
          continue;
        }
        for (const tab of tabs) {
          try {
            await chromeApi.scripting.executeScript({
              target: { tabId: tab.id, allFrames: entry.all_frames === true }, files: entry.js,
            });
            injectedTabs += 1;
          } catch { failedTabs += 1; }
        }
      }
      if (injectedTabs && typeof onReinjected === 'function') {
        try { await onReinjected(injectedTabs); }
        catch (error) { log('[HHR] El aviso post-reinyección falló:', error); }
      }
      return { injectedTabs, failedTabs, complete: failedTabs === 0 };
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
            log('[HHR] No se pudo registrar la re-inyección de esta sesión:', error));
        }
        return { ...result, skipped: false };
      })().finally(() => { pending = null; });
      return pending;
    };
    const start = () => {
      if (!chromeApi.scripting || !chromeApi.runtime.onInstalled) return false;
      chromeApi.runtime.onInstalled.addListener(() => void ensureReinjected({ force: true }));
      void ensureReinjected(); // onInstalled is not guaranteed for developer-mode reloads.
      return true;
    };
    return { start, reinjectRelays, ensureReinjected };
  };
  root.HhrRelayReinjectionRuntime = { create, STORAGE_KEY };
})(typeof self !== 'undefined' ? self : globalThis);
