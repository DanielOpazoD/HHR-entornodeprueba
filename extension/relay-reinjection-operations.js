/** Bounded, manifest-verified relay injection operations. */
(function (root) {
  'use strict';

  const create = ({ chromeApi, withTimeout, timeoutMs, log }) => {
    const { requiredFiles, resolveRelay, matchesPattern } =
      root.HhrRelayReinjectionManifest.create(chromeApi);
    let health;
    const inject = (injection, message) => withTimeout(
      chromeApi.scripting.executeScript(injection),
      timeoutMs,
      message
    );

    const injectRelay = async (relay, tabId, requiredFile) => {
      if (relay.definition.main.length) {
        await inject({
          target: { tabId, allFrames: false },
          world: 'MAIN',
          files: relay.definition.main,
        }, 'La reinyección MAIN excedió el tiempo esperado.');
      }
      await inject({
        target: { tabId, allFrames: relay.definition.allFrames === true },
        files: relay.definition.isolated,
      }, 'La reinyección ISOLATED excedió el tiempo esperado.');
      if (relay.companionEntry) {
        await inject({
          target: { tabId, allFrames: false },
          files: relay.companionEntry.js,
        }, 'La interfaz de Ficha Médico excedió el tiempo esperado.');
      }
      if (!await health.verifyRelay(tabId, requiredFile, relay)) throw new Error('relay_not_ready');
      if (!await health.verifyPresentation(tabId, requiredFile, relay))
        throw new Error('presentation_not_ready');
    };

    const reinjectTab = async ({ tabId, requiredFile }) => {
      const normalizedTabId = Number(tabId);
      if (!Number.isInteger(normalizedTabId) || !requiredFile) {
        return { injected: false, reason: 'invalid_target' };
      }
      const relay = resolveRelay(requiredFile);
      if (!relay) return { injected: false, reason: 'manifest_entry_missing' };
      try {
        const tab = await withTimeout(
          chromeApi.tabs.get(normalizedTabId),
          timeoutMs,
          'No se pudo revalidar la pestaña.'
        );
        if (!(relay.isolatedEntry.matches || []).some(pattern =>
          matchesPattern(tab && tab.url, pattern)
        )) return { injected: false, reason: 'tab_url_mismatch' };
        await injectRelay(relay, normalizedTabId, requiredFile);
        return { injected: true };
      } catch (error) {
        log('[HHR] No se pudo reparar el relé de la pestaña:', error);
        return { injected: false, reason: 'injection_failed' };
      }
    };

    const reinjectMatching = async requiredFile => {
      let injectedTabs = 0;
      let failedTabs = 0;
      const relay = resolveRelay(requiredFile);
      if (!relay) return { injectedTabs, failedTabs: 1, complete: false };
      let tabs;
      try {
        tabs = await withTimeout(
          chromeApi.tabs.query({ url: relay.isolatedEntry.matches || [] }),
          timeoutMs,
          'No se pudieron enumerar las pestañas.'
        );
      } catch (error) {
        log('[HHR] No se pudieron enumerar pestañas para re-inyección:', error);
        return { injectedTabs, failedTabs: 1, complete: false };
      }
      for (const tab of tabs) {
        const result = await reinjectTab({ tabId: tab.id, requiredFile });
        if (result.injected) injectedTabs += 1;
        else failedTabs += 1;
      }
      return { injectedTabs, failedTabs, complete: failedTabs === 0 };
    };

    health = root.HhrRelayReinjectionHealth.create({
      chromeApi, withTimeout, timeoutMs, log,
      requiredFiles, resolveRelay, reinjectTab, matchesPattern,
    });

    const reinjectRelays = async () => {
      let injectedTabs = 0;
      let failedTabs = 0;
      for (const requiredFile of requiredFiles) {
        const result = await reinjectMatching(requiredFile);
        injectedTabs += result.injectedTabs;
        failedTabs += result.failedTabs;
      }
      return { injectedTabs, failedTabs, complete: failedTabs === 0 };
    };

    return Object.freeze({
      reinjectMatching, reinjectTab, reinjectRelays,
      repairMissingRelays: health.repairMissingRelays,
      repairActivatedTab: health.repairActivatedTab,
    });
  };

  root.HhrRelayReinjectionOperations = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
