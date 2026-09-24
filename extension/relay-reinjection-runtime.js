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
    const runAndNotify = async operation => {
      const result = await operation();
      if (result.injectedTabs) notify(result.injectedTabs);
      return result;
    };
    const reinjectRelays = () => runAndNotify(() => operations.reinjectRelays());
    const reinjectRelay = requiredFile => runAndNotify(() => operations.reinjectMatching(requiredFile));
    const repairMissingRelay = requiredFile => runAndNotify(() => operations.repairMissingRelays(requiredFile));
    const { ensureReinjected, whenIdle } = root.HhrRelayReinjectionSession.create({
      chromeApi, operations, reinjectRelays, notify, log,
    });
    const tabEvents = root.HhrRelayReinjectionTabEvents.create({
      chromeApi, operations, whenIdle, notify, log,
    });
    const start = () => {
      if (!chromeApi.scripting || !chromeApi.runtime.onInstalled) return false;
      const verifyOpenTabs = (reason, options) => {
        void ensureReinjected(options).catch(error =>
          log(`[HHR] No se pudo verificar las pestañas al ${reason}:`, error)
        );
      };
      chromeApi.runtime.onInstalled.addListener(() => verifyOpenTabs('actualizar', { force: true }));
      // Restored tabs may appear after onStartup; tabEvents repairs them on load completion.
      chromeApi.runtime.onStartup?.addListener(() => verifyOpenTabs('iniciar Chrome'));
      tabEvents.start();
      verifyOpenTabs('despertar el worker');
      return true;
    };
    return { start, repairMissingRelay, reinjectRelay, reinjectRelays, reinjectTab, ensureReinjected, repairActivatedTab: tabEvents.repairTab };
  };
  root.HhrRelayReinjectionRuntime = { create, STORAGE_KEY: root.HhrRelayReinjectionSession.STORAGE_KEY };
})(typeof self !== 'undefined' ? self : globalThis);
