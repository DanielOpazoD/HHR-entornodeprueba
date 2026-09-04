/** Push de salud inmediato ante cambios de pestañas fuente de Eloísa. */
(function (root) {
  'use strict';

  const SOURCE_RELAY_FILES = new Set(['content-fichamedico.js', 'content-gestioncamas.js']);

  const patternsFromManifest = manifest =>
    (manifest.content_scripts || [])
      .filter(entry => (entry.js || []).some(file => SOURCE_RELAY_FILES.has(file)))
      .flatMap(entry => entry.matches || []);

  const create = ({
    chromeApi,
    pushHealth,
    sourceMatchPatterns = patternsFromManifest(chromeApi.runtime.getManifest()),
    eventDebounceMs = 350,
    log = (...args) => console.warn(...args),
  }) => {
    const prefixes = sourceMatchPatterns
      .map(pattern => String(pattern || '').split('*', 1)[0])
      .filter(Boolean);
    const relevantTabIds = new Set();
    let eventTimer = null;
    let pendingReasons = new Set();

    const matchesSourceUrl = url => {
      const candidate = String(url || '');
      return prefixes.some(prefix => candidate.startsWith(prefix));
    };

    const schedulePush = reason => {
      pendingReasons.add(reason);
      if (eventTimer !== null) clearTimeout(eventTimer);
      eventTimer = setTimeout(() => {
        eventTimer = null;
        const reasons = [...pendingReasons];
        pendingReasons = new Set();
        void Promise.resolve(pushHealth(reasons.join('+'))).catch(error =>
          log('[HHR] No se pudo publicar el cambio de pestañas Eloísa:', error)
        );
      }, eventDebounceMs);
    };

    const rememberTab = (tabId, url) => {
      if (tabId == null) return false;
      const relevant = matchesSourceUrl(url);
      if (relevant) relevantTabIds.add(tabId);
      else relevantTabIds.delete(tabId);
      return relevant;
    };

    const prime = async () => {
      try {
        const tabs = await chromeApi.tabs.query({ url: sourceMatchPatterns });
        tabs.forEach(tab => rememberTab(tab.id, tab.url));
      } catch (error) {
        log('[HHR] No se pudieron registrar las pestañas Eloísa abiertas:', error);
      }
    };

    const start = () => {
      const tabs = chromeApi.tabs;
      if (!tabs || prefixes.length === 0) return false;
      tabs.onUpdated?.addListener((tabId, changeInfo = {}, tab = {}) => {
        const wasRelevant = relevantTabIds.has(tabId);
        const relevant = rememberTab(tabId, changeInfo.url || tab.url);
        if (
          wasRelevant !== relevant ||
          (relevant && (Boolean(changeInfo.url) || changeInfo.status === 'complete'))
        ) {
          schedulePush('source-tab-updated');
        }
      });
      tabs.onRemoved?.addListener(tabId => {
        // onRemoved puede despertar un worker nuevo: Chrome ya no entrega la URL.
        relevantTabIds.delete(tabId);
        schedulePush('source-tab-removed');
      });
      tabs.onActivated?.addListener(activeInfo => {
        const tabId = activeInfo && activeInfo.tabId;
        if (relevantTabIds.has(tabId)) {
          schedulePush('source-tab-activated');
          return;
        }
        if (!tabs.get || tabId == null) return;
        void tabs
          .get(tabId)
          .then(tab => {
            if (rememberTab(tabId, tab && tab.url)) schedulePush('source-tab-activated');
          })
          .catch(() => undefined);
      });
      void prime();
      return true;
    };

    return { start };
  };

  root.HhrHealthTabEventsRuntime = { create, patternsFromManifest };
})(typeof self !== 'undefined' ? self : globalThis);
