/** Bounded, manifest-verified relay injection operations. */
(function (root) {
  'use strict';

  const RELAYS = Object.freeze({
    'content-fichamedico.js': Object.freeze({
      ready: 'fichamedico',
      main: Object.freeze([
        'fichamedico-isolation-normalization.js',
        'fichamedico-treating-physician-dom.js',
        'fichamedico-treating-physician-sources.js',
        'fichamedico-treating-physician-normalization.js',
        'fichamedico-normalization.js',
        'fichamedico-read-resilience.js',
        'bridge-generation-main.js',
        'connection-relay-recovery.js',
        'inject-fichamedico.js',
      ]),
      isolated: Object.freeze([
        'message-contract.js',
        'bridge-generation.js',
        'content-fichamedico.js',
      ]),
    }),
    'content-gestioncamas.js': Object.freeze({
      ready: 'gestioncamas',
      main: Object.freeze([
        'bridge-generation-main.js',
        'connection-relay-recovery.js',
        'inject-gestioncamas.js',
      ]),
      isolated: Object.freeze([
        'message-contract.js',
        'bridge-generation.js',
        'gestion-camas-bridge-health.js',
        'content-gestioncamas.js',
      ]),
    }),
    'content-hhr.js': Object.freeze({
      ready: 'hhr',
      main: Object.freeze([]),
      isolated: Object.freeze([
        'message-contract.js',
        'bridge-generation.js',
        'health-push-ordering-runtime.js',
        'content-hhr-sync-bundle.js',
        'content-hhr-connection-repair.js',
        'content-hhr.js',
        'content-hhr-patient-flow.js',
        'content-hhr-epicrisis.js',
        'content-hhr-patient-documents.js',
        'content-hhr-statistical-discharge.js',
        'content-hhr-statistical-evidence.js',
        'content-hhr-syslab.js',
      ]),
    }),
    'syslab-bridge.js': Object.freeze({
      ready: null,
      allFrames: true,
      main: Object.freeze([]),
      isolated: Object.freeze(['lab-result-parser.js', 'lab-viewer.js', 'syslab-bridge.js']),
    }),
  });

  const matchesPattern = (url, pattern) => {
    if (typeof url !== 'string' || typeof pattern !== 'string') return false;
    const escaped = pattern.replace(/[.+?^\${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$').test(url);
  };

  const create = ({ chromeApi, withTimeout, timeoutMs, log }) => {
    const entries = () => chromeApi.runtime.getManifest().content_scripts || [];
    const entryFor = (requiredFile, world) =>
      entries().find(entry =>
        (world === 'MAIN' ? entry.world === 'MAIN' : entry.world !== 'MAIN') &&
        Array.isArray(entry.js) &&
        entry.js.includes(requiredFile)
      );
    const resolveRelay = requiredFile => {
      const definition = RELAYS[requiredFile];
      const isolatedEntry = entryFor(requiredFile, 'ISOLATED');
      if (!definition || !isolatedEntry) return null;
      if (!definition.isolated.every(file => isolatedEntry.js.includes(file))) return null;
      const mainEntry = definition.main.length
        ? entryFor(definition.main.at(-1), 'MAIN')
        : null;
      if (definition.main.length && (
        !mainEntry || !definition.main.every(file => mainEntry.js.includes(file))
      )) return null;
      return { definition, isolatedEntry };
    };
    const inject = (injection, message) => withTimeout(
      chromeApi.scripting.executeScript(injection),
      timeoutMs,
      message
    );

    const injectRelay = async (relay, tabId) => {
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
      if (!relay.definition.ready) return;
      const response = await withTimeout(
        chromeApi.tabs.sendMessage(tabId, { type: 'RAYEN_EXTENSION_RELAY_PING' }),
        timeoutMs,
        'El relé reinyectado no confirmó su receptor.'
      );
      if (response?.relayReady !== relay.definition.ready) throw new Error('relay_not_ready');
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
        await injectRelay(relay, normalizedTabId);
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

    const reinjectRelays = async () => {
      let injectedTabs = 0;
      let failedTabs = 0;
      for (const requiredFile of Object.keys(RELAYS)) {
        const result = await reinjectMatching(requiredFile);
        injectedTabs += result.injectedTabs;
        failedTabs += result.failedTabs;
      }
      return { injectedTabs, failedTabs, complete: failedTabs === 0 };
    };

    return Object.freeze({ reinjectMatching, reinjectTab, reinjectRelays });
  };

  root.HhrRelayReinjectionOperations = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
