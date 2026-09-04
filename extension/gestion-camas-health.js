/** Live-tab and session readiness gate for Gestión de Camas. */
(function (root) {
  'use strict';

  const reasonOf = (value, fallback = 'session_unverified') => {
    if (value && value.reason) return value.reason;
    return value && value.status === 'ready' ? 'connected' : fallback;
  };

  const create = dependencies => {
    const {
      chromeApi,
      extensionHealth,
      session,
      withTimeout,
      healthProbeTimeoutMs,
      matchPattern,
      readSession,
      clearUnusableSession,
      requestLiveSession,
      verifySession,
    } = dependencies;

    return async (runtimeGeneration, targetTabIds) => {
      const matchingTabs = extensionHealth.orderTabs(
        await extensionHealth.resolveTabs(chromeApi.tabs, matchPattern, targetTabIds)
      );
      const tabHealth = await extensionHealth.probeTabs({
        tabs: matchingTabs,
        sendMessage: (tabId, message) =>
          withTimeout(
            chromeApi.tabs.sendMessage(tabId, message),
            healthProbeTimeoutMs,
            'La pestaña de Gestión de Camas no respondió a la comprobación.'
          ),
        missingMessage: 'Abre Gestión de Camas e inicia sesión para sincronizar.',
        staleMessage: 'Abre una pestaña nueva de Gestión de Camas para activar la extensión vigente.',
        healthMessage: { type: 'RAYEN_EXTENSION_HEALTH_PING', runtimeGeneration },
      });
      if (tabHealth.status !== 'ready') return tabHealth;
      const withBridge = status => ({
        ...status,
        reason: reasonOf(status),
        bridgeVersion: tabHealth.bridgeVersion,
        bridgeGeneration: tabHealth.bridgeGeneration,
      });

      let record = await readSession();
      if (
        session.isUsable(record) &&
        !matchingTabs.some(tab => Number(tab?.id) === Number(record.sourceTabId))
      ) {
        // La pestaña de origen murió, pero hay pestañas de Gestión de Camas
        // vivas (el probe de arriba ya respondió): adoptar su sesión en vivo
        // en lugar de exigir una reconexión manual.
        const live = await requestLiveSession({
          verificationTimeoutMs: healthProbeTimeoutMs,
          tabTimeoutMs: healthProbeTimeoutMs, targetTabIds,
        });
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
          const live = await requestLiveSession({
            verificationTimeoutMs: healthProbeTimeoutMs,
            tabTimeoutMs: healthProbeTimeoutMs, targetTabIds,
          });
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
      if (verified.changed) return withBridge(session.publicStatus(await readSession()));
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
