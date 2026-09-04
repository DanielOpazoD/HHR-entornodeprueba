/**
 * relay-reinjection-runtime.js
 *
 * Recargar o actualizar la extensión invalida el contexto de los content
 * scripts ya inyectados: los relés ISOLATED quedan huérfanos (su
 * chrome.runtime lanza «Extension context invalidated» y nunca responden) y
 * cada pestaña de Rayen/HHR abierta exigía una recarga manual. Este runtime
 * re-inyecta los relés declarados en el manifest en las pestañas abiertas al
 * instalarse la nueva versión.
 *
 * Los scripts de mundo MAIN (inject-*.js) NO se re-inyectan: no usan
 * chrome.runtime y duplicarlos envolvería fetch/XHR dos veces. El handshake
 * de versión + generación los marca como obsoletos; la reparación abre un
 * documento nuevo sin recargar silenciosamente la pestaña anterior.
 */
(function (root) {
  'use strict';

  const create = ({ chromeApi, onReinjected, log = (...args) => console.warn(...args) }) => {
    const reinjectRelays = async () => {
      const entries = (chromeApi.runtime.getManifest().content_scripts || []).filter(
        entry => entry.world !== 'MAIN' && Array.isArray(entry.js) && entry.js.length
      );
      let injectedTabs = 0;
      for (const entry of entries) {
        let tabs = [];
        try {
          tabs = await chromeApi.tabs.query({ url: entry.matches || [] });
        } catch (error) {
          log('[HHR] No se pudieron enumerar pestañas para re-inyección:', error);
          continue;
        }
        for (const tab of tabs) {
          try {
            await chromeApi.scripting.executeScript({
              target: { tabId: tab.id, allFrames: entry.all_frames === true },
              files: entry.js,
            });
            injectedTabs += 1;
          } catch {
            // Pestaña descartada, protegida o a medio cargar: la re-inyección
            // es oportunista; el health seguirá pidiendo recarga manual ahí.
          }
        }
      }
      if (injectedTabs && typeof onReinjected === 'function') {
        try {
          await onReinjected(injectedTabs);
        } catch (error) {
          log('[HHR] El aviso post-reinyección falló:', error);
        }
      }
      return { injectedTabs };
    };

    const start = () => {
      if (!chromeApi.scripting || !chromeApi.runtime.onInstalled) return false;
      chromeApi.runtime.onInstalled.addListener(() => void reinjectRelays());
      return true;
    };

    return { start, reinjectRelays };
  };

  root.HhrRelayReinjectionRuntime = { create };
})(typeof self !== 'undefined' ? self : globalThis);
