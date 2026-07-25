/** Live-tab and session readiness gate for Gestión de Camas. */
(function (root) {
  'use strict';

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

    return async () => {
      const matchingTabs = extensionHealth.orderTabs(
        await chromeApi.tabs.query({ url: matchPattern })
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
        staleMessage: 'Recarga la pestaña de Gestión de Camas para activar la extensión.',
      });
      if (tabHealth.status !== 'ready') return tabHealth;

      let record = await readSession();
      if (
        session.isUsable(record) &&
        !matchingTabs.some(tab => Number(tab?.id) === Number(record.sourceTabId))
      ) {
        return {
          status: 'stale',
          message:
            'La sesión guardada pertenece a una pestaña cerrada. Vuelve a conectar Gestión de Camas.',
        };
      }
      if (!session.isUsable(record)) {
        record = await clearUnusableSession();
        if (!session.isUsable(record)) {
          const live = await requestLiveSession({
            verificationTimeoutMs: healthProbeTimeoutMs,
            tabTimeoutMs: healthProbeTimeoutMs,
          });
          if (!live.record) {
            return {
              ...session.publicStatus(null),
              message: live.error || 'Gestión de Camas no está conectada.',
            };
          }
          record = live.record;
        }
      }
      if (session.isVerificationFresh(record)) return session.publicStatus(record);
      const verified = await verifySession(record, healthProbeTimeoutMs);
      if (verified.record) return session.publicStatus(verified.record);
      if (verified.changed) return session.publicStatus(await readSession());
      const status = session.publicStatus(record);
      return { ...status, status: 'stale', message: verified.error || status.message };
    };
  };

  root.HhrGestionCamasHealth = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
