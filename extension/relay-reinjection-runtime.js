(function (root) {
  'use strict';
  const STORAGE_KEY = 'hhrRelaysInjectedForSessionV1';
  const RELAYS = Object.freeze({
    'content-fichamedico.js': ['fichamedico', 'inject-fichamedico.js', 'message-contract.js', 'bridge-generation.js', 'content-fichamedico.js'],
    'content-gestioncamas.js': ['gestioncamas', 'inject-gestioncamas.js', 'message-contract.js', 'bridge-generation.js', 'gestion-camas-bridge-health.js', 'content-gestioncamas.js'],
    'content-hhr.js': ['hhr', '', 'message-contract.js', 'bridge-generation.js', 'health-push-ordering-runtime.js', 'content-hhr-sync-bundle.js', 'content-hhr.js'] });
  const create = ({ chromeApi, onReinjected, log = (...args) => console.warn(...args) }) => {
    let pending = null;
    const isolatedEntries = () => (chromeApi.runtime.getManifest().content_scripts || []).filter(entry =>
      entry.world !== 'MAIN' && Array.isArray(entry.js) && entry.js.length);
    const relayEntry = requiredFile => isolatedEntries().find(entry => entry.js.includes(requiredFile));
    const injectRelay = async (requiredFile, tabId) => {
      const [ready, mainFile, ...files] = RELAYS[requiredFile] || [], entry = relayEntry(requiredFile);
      if (!ready || !entry || !files.every(file => entry.js.includes(file))) throw new Error('manifest_entry_missing');
      if (mainFile) await chromeApi.scripting.executeScript({ target: { tabId, allFrames: false }, world: 'MAIN', files: [mainFile] }); await chromeApi.scripting.executeScript({ target: { tabId, allFrames: false }, files });
      const response = await chromeApi.tabs.sendMessage(tabId, { type: 'RAYEN_EXTENSION_RELAY_PING' });
      if (response?.relayReady !== ready) throw new Error('relay_not_ready');
    };
    const notify = count => { if (typeof onReinjected !== 'function') return; try {
        Promise.resolve(onReinjected(count)).catch(error => log('[HHR] El aviso post-reinyección falló:', error));
      } catch (error) { log('[HHR] El aviso post-reinyección falló:', error); } };
    const reinjectTab = async ({ tabId, requiredFile }) => {
      const normalizedTabId = Number(tabId);
      if (!Number.isInteger(normalizedTabId) || !requiredFile) return { injected: false, reason: 'invalid_target' };
      const entry = relayEntry(requiredFile); if (!RELAYS[requiredFile] || !entry) return { injected: false, reason: 'manifest_entry_missing' };
      const matchingTabs = await chromeApi.tabs.query({ url: entry.matches || [] }).catch(() => []);
      if (!matchingTabs.some(tab => Number(tab.id) === normalizedTabId)) return { injected: false, reason: 'tab_url_mismatch' };
      try { await injectRelay(requiredFile, normalizedTabId); notify(1);
        return { injected: true }; } // No esperar el heartbeat: vuelve a este probe.
      catch (error) { log('[HHR] No se pudo reparar el relé de la pestaña:', error);
        return { injected: false, reason: 'injection_failed' }; }
    };
    const reinjectRelays = async () => {
      let injectedTabs = 0, failedTabs = 0;
      for (const requiredFile of Object.keys(RELAYS)) {
        const entry = relayEntry(requiredFile);
        if (!entry) { failedTabs += 1; continue; }
        let tabs = [];
        try { tabs = await chromeApi.tabs.query({ url: entry.matches || [] }); }
        catch (error) { failedTabs += 1;
          log('[HHR] No se pudieron enumerar pestañas para re-inyección:', error); continue; }
        for (const tab of tabs) {
          try { await injectRelay(requiredFile, tab.id); injectedTabs += 1; }
          catch { failedTabs += 1; }
        }
      }
      if (injectedTabs) notify(injectedTabs); return { injectedTabs, failedTabs, complete: failedTabs === 0 };
    };
    const ensureReinjected = ({ force = false } = {}) => {
      if (pending) return pending;
      return pending = (async () => {
        const session = chromeApi.storage?.session, version = String(chromeApi.runtime.getManifest().version || 'unknown');
        const stored = !force && session ? await session.get(STORAGE_KEY).catch(() => ({})) : {};
        if (stored?.[STORAGE_KEY] === version) return { injectedTabs: 0, skipped: true };
        const result = await reinjectRelays();
        if (session && result.complete) await session.set({ [STORAGE_KEY]: version })
          .catch(error => log('[HHR] No se pudo registrar la re-inyección de esta sesión:', error));
        return { ...result, skipped: false };
      })().finally(() => { pending = null; });
    };
    const start = () => { if (!chromeApi.scripting || !chromeApi.runtime.onInstalled) return false;
      chromeApi.runtime.onInstalled.addListener(() => void ensureReinjected({ force: true })); void ensureReinjected(); return true;
    }; return { start, reinjectRelays, reinjectTab, ensureReinjected };
  };
  root.HhrRelayReinjectionRuntime = { create, STORAGE_KEY }; })(typeof self !== 'undefined' ? self : globalThis);
