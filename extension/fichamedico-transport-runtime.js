/**
 * Ficha Médico transport runtime (classic UMD for the MV3 service worker).
 *
 * Owns tab selection, bounded messages, census snapshots, encounter navigation and the
 * Ficha Médico health/session probes. The background worker remains the protocol orchestrator.
 */
(function (root) {
  'use strict';

  const FICHAMEDICO_MATCH = 'https://fichamedico.rayensalud.cl/*';

  const assertFunction = (value, name) => {
    if (typeof value !== 'function') throw new Error(`Falta la dependencia ${name}.`);
    return value;
  };

  const assertPositiveTimeout = (value, name) => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`El timeout ${name} no es válido.`);
    }
    return value;
  };

  const create = dependencies => {
    const deps = dependencies || {};
    const chromeApi = deps.chrome;
    const tabs = chromeApi && chromeApi.tabs;
    const windows = chromeApi && chromeApi.windows;
    const extensionHealth = deps.extensionHealth;
    const encounterNavigation = deps.encounterNavigation;
    const withTimeout = assertFunction(deps.withTimeout, 'withTimeout');
    const tabMessageTimeoutMs = assertPositiveTimeout(
      deps.tabMessageTimeoutMs,
      'tabMessageTimeoutMs'
    );
    const healthProbeTimeoutMs = assertPositiveTimeout(
      deps.healthProbeTimeoutMs,
      'healthProbeTimeoutMs'
    );

    if (!tabs) throw new Error('Falta la dependencia chrome.tabs.');
    ['query', 'sendMessage', 'update', 'create'].forEach(method =>
      assertFunction(tabs[method], `chrome.tabs.${method}`)
    );
    assertFunction(windows && windows.update, 'chrome.windows.update');
    assertFunction(extensionHealth && extensionHealth.orderTabs, 'extensionHealth.orderTabs');
    assertFunction(extensionHealth && extensionHealth.probeTabs, 'extensionHealth.probeTabs');
    assertFunction(
      encounterNavigation && encounterNavigation.normalizeEncounterId,
      'encounterNavigation.normalizeEncounterId'
    );
    assertFunction(
      encounterNavigation && encounterNavigation.orderEncounterTabs,
      'encounterNavigation.orderEncounterTabs'
    );
    assertFunction(
      encounterNavigation && encounterNavigation.buildEncounterUrl,
      'encounterNavigation.buildEncounterUrl'
    );

    const sendHealthProbe = (tabId, message) =>
      withTimeout(
        tabs.sendMessage(tabId, message),
        healthProbeTimeoutMs,
        'La pestaña no respondió a la verificación de conexión.'
      );

    // Some open tabs may be stale and lack the content script. Preserve the priority order and
    // return the first successful response while retaining the last useful diagnostic.
    const sendToMatchingTab = async (urlMatch, message, noTabError, noAnswerError) => {
      const matchingTabs = await tabs.query({ url: urlMatch });
      if (!matchingTabs.length) return { error: noTabError };
      const ordered = extensionHealth.orderTabs(matchingTabs);
      let lastError = 'Sin respuesta de la pestaña.';
      for (const tab of ordered) {
        try {
          const response = await withTimeout(
            tabs.sendMessage(tab.id, message),
            tabMessageTimeoutMs,
            'La pestaña de Ficha Médico no respondió dentro del tiempo esperado.'
          );
          if (response && !response.error) return response;
          if (response && response.error) lastError = String(response.error);
        } catch (error) {
          lastError = String((error && error.message) || error);
        }
      }
      return { error: noAnswerError + ' Detalle: ' + lastError };
    };

    const handleSnapshotRequest = () =>
      sendToMatchingTab(
        FICHAMEDICO_MATCH,
        { type: 'RAYEN_READ' },
        'No hay una pestaña de Rayen (Ficha Médico) abierta. Ábrela e inicia sesión.',
        'No se pudo leer Rayen. Recarga la pestaña de Ficha Médico (Cmd+R) para activar la extensión y reintenta.'
      );

    const handleOpenEncounter = async encId => {
      const normalizedEncounterId = encounterNavigation.normalizeEncounterId(encId);
      if (!normalizedEncounterId) {
        return { ok: false, reused: false, error: 'El episodio clínico no es válido.' };
      }

      try {
        const matchingTabs = await tabs.query({ url: FICHAMEDICO_MATCH });
        const orderedTabs = encounterNavigation.orderEncounterTabs(matchingTabs);
        const existingTab = orderedTabs[0];
        const reused = Boolean(existingTab && existingTab.id != null);
        const targetUrl = encounterNavigation.buildEncounterUrl(
          normalizedEncounterId,
          existingTab && existingTab.url
        );
        const tab = reused
          ? await tabs.update(existingTab.id, { url: targetUrl, active: true })
          : await tabs.create({ url: targetUrl, active: true });

        if (tab && tab.windowId != null) {
          try {
            await windows.update(tab.windowId, { focused: true });
          } catch (_error) {
            // Opening the encounter succeeded; foregrounding its window remains best-effort.
          }
        }
        return { ok: true, reused };
      } catch (error) {
        return {
          ok: false,
          reused: false,
          error: 'No se pudo abrir Ficha Médico: ' + String((error && error.message) || error),
        };
      }
    };

    const health = () =>
      tabs.query({ url: FICHAMEDICO_MATCH }).then(matchingTabs =>
        extensionHealth.probeTabs({
          tabs: matchingTabs,
          sendMessage: sendHealthProbe,
          missingMessage: 'Abre Ficha Médico e inicia sesión para sincronizar.',
          staleMessage: 'Recarga la pestaña de Ficha Médico para activar la extensión.',
        })
      );

    const senderTabId = sender => {
      const tabId = sender && sender.tab && sender.tab.id;
      const tabUrl = String((sender && sender.tab && sender.tab.url) || (sender && sender.url) || '');
      return tabId != null && tabUrl.startsWith('https://fichamedico.rayensalud.cl/')
        ? tabId
        : null;
    };

    const getFetchInfo = async sender => {
      const directTabId = senderTabId(sender);
      if (directTabId != null) {
        try {
          const direct = await withTimeout(
            tabs.sendMessage(directTabId, { type: 'RAYEN_FM_GET_FETCH_INFO' }),
            tabMessageTimeoutMs,
            'La pestaña de Ficha Médico no respondió dentro del tiempo esperado.'
          );
          if (direct && direct.info && direct.info.token && direct.info.apiOrigin) {
            return { info: direct.info };
          }
          return {
            error:
              (direct && direct.error) ||
              'La pestaña emisora no entregó una sesión clínica válida.',
          };
        } catch (_error) {}
        return {
          error:
            'No se pudo verificar la sesión de la pestaña emisora. Recárgala e inicia sesión nuevamente.',
        };
      }

      const infoResponse = await sendToMatchingTab(
        FICHAMEDICO_MATCH,
        { type: 'RAYEN_FM_GET_FETCH_INFO' },
        'No hay una pestaña de Ficha Médico abierta. Ábrela e inicia sesión.',
        'No se pudo obtener la sesión de Ficha Médico. Recarga la página (Cmd+R) y reintenta.'
      );
      if (infoResponse.error) return { error: infoResponse.error };
      const info = infoResponse.info;
      if (!info || !info.token || !info.apiOrigin) {
        return { error: 'Sin sesión de Ficha Médico. Recarga la página e inicia sesión.' };
      }
      return { info };
    };

    return Object.freeze({
      sendToMatchingTab,
      handleSnapshotRequest,
      handleOpenEncounter,
      health,
      getFetchInfo,
    });
  };

  const api = Object.freeze({ create });
  root.HhrFichaMedicoTransportRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
