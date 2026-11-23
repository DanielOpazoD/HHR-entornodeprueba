/** Bridge and background session health for Gestión de Camas. */
(function (root) {
  'use strict';

  const create = dependencies => {
    const { chromeApi, extensionHealth, withTimeout, healthProbeTimeoutMs } = dependencies;
    const { matchPattern, recoverMissingReceiver } = dependencies;
    const readSessionHealth = root.HhrGestionCamasSessionHealth.create(dependencies);
    const sendHealthProbe = root.HhrConnectionRelayRecovery.createHealthProbe({
      sendMessage: chromeApi.tabs.sendMessage.bind(chromeApi.tabs),
      withTimeout,
      timeoutMs: healthProbeTimeoutMs,
      recoverMissingReceiver,
      timeoutMessage: 'La pestaña de Gestión de Camas no respondió a la comprobación.',
    });

    return async (runtimeGeneration, targetTabIds, { verifySessions = false, bindScope = true } = {}) => {
      const readyTabIds = [];
      const matchingTabs = extensionHealth.orderTabs(
        await extensionHealth.resolveTabs(chromeApi.tabs, matchPattern, targetTabIds)
      );
      const readBackground = async () => {
        if (Array.isArray(targetTabIds) || !bindScope) return null;
        const status = await readSessionHealth({ matchingTabs, verifySessions, background: true });
        return status && { ...status, usingBackgroundSession: true };
      };
      if (bindScope && !Array.isArray(targetTabIds) && !matchingTabs.length) return readBackground();
      const tabHealth = await extensionHealth.probeTabs({
        tabs: matchingTabs,
        sendMessage: async (tabId, message) => {
          const response = await sendHealthProbe(tabId, message);
          if (response?.ready === true) readyTabIds.push(tabId);
          return response;
        },
        missingMessage: 'Abre Gestión de Camas e inicia sesión para sincronizar.',
        staleMessage: 'Abre una pestaña nueva de Gestión de Camas para activar la extensión vigente.',
        healthMessage: { type: 'RAYEN_EXTENSION_HEALTH_PING', runtimeGeneration },
      });
      if (tabHealth.status !== 'ready') return await readBackground() || tabHealth;
      const status = await readSessionHealth({
        matchingTabs,
        verifySessions,
        bindScope,
        liveOptions: {
          verificationTimeoutMs: healthProbeTimeoutMs, tabTimeoutMs: healthProbeTimeoutMs,
          targetTabIds, confirmedTabIds: readyTabIds,
        },
      });
      if (status.status !== 'ready') {
        const background = await readBackground();
        if (background) return background;
      }
      return {
        ...status,
        bridgeVersion: tabHealth.bridgeVersion,
        bridgeGeneration: tabHealth.bridgeGeneration,
        pageState: tabHealth.pageState || 'unknown',
        pageRoute: tabHealth.pageRoute || '',
      };
    };
  };

  root.HhrGestionCamasHealth = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
