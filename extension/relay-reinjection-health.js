/** Verify existing receivers before repairing one tab or a bounded set of tabs. */
(function (root) {
  'use strict';
  const create = ({ chromeApi, withTimeout, timeoutMs, log, requiredFiles, resolveRelay, reinjectTab, matchesPattern }) => {
    const verifyRelay = async (tabId, requiredFile, relay) => {
      if (requiredFile === 'syslab-bridge.js') {
        const frames = await withTimeout(chromeApi.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => location.href,
        }), timeoutMs, 'No se pudieron enumerar los marcos de Syslab.');
        const targets = Array.isArray(frames) ? frames.filter(frame =>
          Number.isInteger(frame.frameId) && (relay.isolatedEntry.matches || [])
            .some(pattern => matchesPattern(frame.result, pattern))
        ) : [];
        if (!targets.length) return false;
        const statuses = await Promise.all(targets.map(frame => withTimeout(
          chromeApi.tabs.sendMessage(tabId, { type: 'RAYEN_SYSLAB_STATUS' },
            { frameId: frame.frameId }),
          timeoutMs, 'Un marco de Syslab no confirmó su receptor.'
        )));
        return statuses.every(status => status?.ok === true && Boolean(status.bridgeId));
      }
      const response = await withTimeout(
        chromeApi.tabs.sendMessage(tabId, { type: 'RAYEN_EXTENSION_RELAY_PING' }),
        timeoutMs, 'El relé no confirmó su receptor.'
      );
      return response?.relayReady === relay.definition.ready;
    };
    const verifyPresentation = async (tabId, requiredFile, relay) => {
      if (relay.companionEntry) {
        const ui = await withTimeout(
          chromeApi.tabs.sendMessage(tabId, { type: 'RAYEN_EXTENSION_FICHA_UI_PING' }),
          timeoutMs, 'La interfaz de Ficha Médico no confirmó su conexión.'
        );
        if (ui?.uiReady !== true) return false;
        const main = await withTimeout(
          chromeApi.tabs.sendMessage(tabId, { type: 'RAYEN_EXTENSION_MAIN_PING' }),
          timeoutMs, 'El lector interno de Ficha Médico no confirmó su conexión.'
        );
        if (main?.reason === 'incompatible_reader' || main?.reason === 'unverified_reader') {
          return main.reason;
        }
        return main?.mainReady === true;
      }
      if (requiredFile === 'content-gestioncamas.js') {
        const indicator = await withTimeout(
          chromeApi.tabs.sendMessage(tabId, { type: 'RAYEN_EXTENSION_INDICATOR_PING' }),
          timeoutMs, 'El indicador de Camas no confirmó su conexión.'
        );
        return indicator?.indicatorReady === true;
      }
      return true;
    };
    const verifyOrReinject = async (tab, requiredFile, relay) => {
      try {
        if (await verifyRelay(tab.id, requiredFile, relay)) {
          const presentation = await verifyPresentation(tab.id, requiredFile, relay);
          if (presentation === true) return { injected: false, healthy: true };
          if (presentation === 'incompatible_reader' || presentation === 'unverified_reader') {
            return { injected: false, healthy: false, reason: presentation };
          }
        }
      } catch (_error) {
        // A missing/invalidated receiver is expected after an extension reload.
      }
      return reinjectTab({ tabId: tab.id, requiredFile });
    };

    const repairMissingRelays = async () => {
      let injectedTabs = 0;
      let failedTabs = 0;
      for (const requiredFile of requiredFiles) {
        const relay = resolveRelay(requiredFile);
        if (!relay) continue;
        let tabs;
        try {
          tabs = await withTimeout(
            chromeApi.tabs.query({ url: relay.isolatedEntry.matches || [] }),
            timeoutMs,
            'No se pudieron enumerar las pestañas para verificar los relés.'
          );
        } catch (error) {
          log('[HHR] No se pudieron verificar pestañas del relé:', error);
          failedTabs += 1;
          continue;
        }
        const results = await Promise.all(tabs.map(tab => verifyOrReinject(tab, requiredFile, relay)));
        for (const result of results) {
          if (result.injected) injectedTabs += 1;
          else if (!result.healthy) failedTabs += 1;
        }
      }
      return { injectedTabs, failedTabs, complete: failedTabs === 0 };
    };

    const repairActivatedTab = async tabId => {
      let tab;
      try {
        tab = await withTimeout(chromeApi.tabs.get(tabId), timeoutMs, 'No se pudo revalidar la pestaña activa.');
      } catch (_error) {
        return { injected: false, reason: 'tab_unavailable' };
      }
      for (const requiredFile of requiredFiles) {
        const relay = resolveRelay(requiredFile);
        if (!relay) continue;
        if ((relay.isolatedEntry.matches || []).some(pattern => matchesPattern(tab?.url, pattern))) {
          return verifyOrReinject(tab, requiredFile, relay);
        }
      }
      return { injected: false, healthy: true };
    };
    return Object.freeze({ repairMissingRelays, repairActivatedTab, verifyRelay, verifyPresentation });
  };
  root.HhrRelayReinjectionHealth = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
