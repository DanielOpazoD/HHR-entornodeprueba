/** Live-tab and session readiness gate for Gestión de Camas. */
(function (root) {
  'use strict';

  const reasonOf = (value, fallback = 'session_unverified') => {
    if (value && value.reason) return value.reason;
    return value && value.status === 'ready' ? 'connected' : fallback;
  };

  const create = dependencies => {
    const { chromeApi, extensionHealth, session, withTimeout, healthProbeTimeoutMs } = dependencies;
    const { matchPattern, readSession, clearUnusableSession, recoverMissingReceiver } = dependencies;
    const { requestLiveSession, verifySession } = dependencies;
    const sendHealthProbe = root.HhrConnectionRelayRecovery.createHealthProbe({
      sendMessage: chromeApi.tabs.sendMessage.bind(chromeApi.tabs),
      withTimeout,
      timeoutMs: healthProbeTimeoutMs,
      recoverMissingReceiver,
      timeoutMessage: 'La pestaña de Gestión de Camas no respondió a la comprobación.',
    });

    return async (runtimeGeneration, targetTabIds) => {
      const readyTabIds = [];
      const matchingTabs = extensionHealth.orderTabs(
        await extensionHealth.resolveTabs(chromeApi.tabs, matchPattern, targetTabIds)
      );
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
      if (tabHealth.status !== 'ready') return tabHealth;
      const liveOptions = {
        verificationTimeoutMs: healthProbeTimeoutMs, tabTimeoutMs: healthProbeTimeoutMs,
        targetTabIds, confirmedTabIds: readyTabIds,
      };
      const withBridge = status => ({
        ...status,
        reason: reasonOf(status),
        bridgeVersion: tabHealth.bridgeVersion,
        bridgeGeneration: tabHealth.bridgeGeneration,
        pageState: tabHealth.pageState || 'unknown',
        pageRoute: tabHealth.pageRoute || '',
      });

      let record = await readSession();
      if (
        session.isUsable(record) &&
        !matchingTabs.some(tab => Number(tab?.id) === Number(record.sourceTabId))
      ) {
        const live = await requestLiveSession(liveOptions);
        if (live.record) return withBridge(session.publicStatus(live.record));
        return withBridge({
          status: 'stale',
          reason: reasonOf(live),
          message:
            live.error ||
            'La sesión guardada pertenece a una pestaña cerrada. Vuelve a conectar Gestión de Camas.',
        });
      }
      if (!session.isUsable(record)) {
        record = await clearUnusableSession();
        if (!session.isUsable(record)) {
          const live = await requestLiveSession(liveOptions);
          if (!live.record) {
            return withBridge({
              ...session.publicStatus(null),
              reason: reasonOf(live),
              message: live.error || 'Gestión de Camas no está conectada.',
            });
          }
          record = live.record;
        }
      }
      if (session.isVerificationFresh(record)) return withBridge(session.publicStatus(record));
      const verified = await verifySession(record, healthProbeTimeoutMs);
      if (verified.record) return withBridge(session.publicStatus(verified.record));
      if (verified.reason === 'session_expired') {
        const live = await requestLiveSession(liveOptions);
        if (live.record) return withBridge(session.publicStatus(live.record));
      }
      const status = session.publicStatus(record);
      return withBridge({
        ...status,
        status: 'stale',
        reason: reasonOf(verified, reasonOf(status)),
        message: verified.error || status.message,
      });
    };
  };

  root.HhrGestionCamasHealth = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
