/** Pure helpers for the extension capability handshake (also exercised from Vitest). */
(function (root) {
  'use strict';
  const orderTabs = tabs =>
    (Array.isArray(tabs) ? tabs.slice() : []).sort((a, b) => {
      const activeDelta = Number(Boolean(b && b.active)) - Number(Boolean(a && a.active));
      if (activeDelta !== 0) return activeDelta;
      return Number((b && b.lastAccessed) || 0) - Number((a && a.lastAccessed) || 0);
    });
  const resolveTabs = async (tabsApi, url, ids) => {
    if (!Array.isArray(ids)) return tabsApi.query({ url });
    const settled = await Promise.allSettled(ids.map(id => tabsApi.get(Number(id))));
    return settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
  };
  // Vigencia de la sesión de la fuente (epoch ms y segundos restantes), solo si la publica.
  const sessionExpiryOf = response => ({
    ...(Number.isFinite(response.expiresAt) ? { expiresAt: response.expiresAt } : {}),
    ...(Number.isFinite(response.remainingSeconds)
      ? { remainingSeconds: response.remainingSeconds }
      : {}),
  });
  const readyResult = response => {
    const expiry = sessionExpiryOf(response);
    return {
      publishesExpiry: Object.keys(expiry).length > 0,
      result: {
        status: 'ready',
        reason: 'connected',
        message: response.message || 'Pestaña disponible.',
        ...(response.identity ? { identity: response.identity } : {}),
        ...(response.bridgeVersion ? { bridgeVersion: response.bridgeVersion } : {}),
        ...(response.bridgeGeneration ? { bridgeGeneration: response.bridgeGeneration } : {}),
        ...expiry,
      },
    };
  };
  // Solo Ficha Médico opta por `preferExpiryPublisher` (Gestión de Camas nunca publica
  // vigencia): heurística de transición (un inject < 0.48.5 respondía «lista» sin vigencia;
  // desde 0.48.8 el relay marca «no lista» un inject de otra versión). Si alguna pestaña
  // publica vigencia, esa es la respuesta honesta.
  const resolveReady = (readyOutcomes, preferExpiryPublisher) => {
    if (preferExpiryPublisher) {
      const publisher = readyOutcomes.find(ready => ready.publishesExpiry);
      if (publisher) return publisher.result;
    }
    return readyOutcomes[0].result;
  };

  const probeTabs = async ({
    tabs,
    sendMessage,
    missingMessage,
    staleMessage,
    preferExpiryPublisher = false,
    healthMessage = { type: 'RAYEN_EXTENSION_HEALTH_PING' },
  }) => {
    const ordered = orderTabs(tabs);
    if (ordered.length === 0) {
      return { status: 'missing', reason: 'tab_missing', message: missingMessage };
    }
    let unavailableMessage = '';
    let unavailableReason = '';
    const ping = tab => sendMessage(tab.id, healthMessage);

    // Una sola pestaña sana de la fuente basta. Se sondean todas a la vez para que la
    // espera total sea un único tiempo de espera y no uno por pestaña: con varias
    // pestañas abiertas, una lenta ya no puede agotar el presupuesto de las demás.
    const candidates = ordered.filter(tab => tab && tab.id != null);
    const settled = await Promise.allSettled(candidates.map(ping));
    const readyOutcomes = [];
    for (const outcome of settled) {
      const response = outcome.status === 'fulfilled' ? outcome.value : null;
      if (response && response.ready === true) {
        readyOutcomes.push(readyResult(response));
        continue;
      }
      if (!unavailableMessage && response && response.message) {
        unavailableMessage = response.message;
        unavailableReason = String(response.reason || 'session_unverified');
      }
    }
    if (readyOutcomes.length > 0) return resolveReady(readyOutcomes, preferExpiryPublisher);

    return {
      status: 'stale',
      reason: unavailableReason || 'relay_disconnected',
      message: unavailableMessage || staleMessage,
    };
  };

  const createHhrProbe = ({ chromeApi, withTimeout, timeoutMs, matches }) =>
    runtimeContext => chromeApi.tabs.query({ url: matches }).then(tabs => probeTabs({
      tabs,
      sendMessage: (tabId, message) => withTimeout(
        chromeApi.tabs.sendMessage(tabId, message),
        timeoutMs,
        'La pestaña HHR no respondió a la comprobación.'
      ),
      missingMessage: 'Abre HHR para completar el enlace con la extensión.',
      staleMessage: 'La pestaña HHR no respondió al relé de la extensión.',
      healthMessage: {
        type: 'RAYEN_EXTENSION_HHR_HEALTH_PING',
        runtimeGeneration: runtimeContext.runtimeGeneration,
      },
    }));

  root.HhrExtensionHealth = { orderTabs, resolveTabs, probeTabs, createHhrProbe };
})(typeof self !== 'undefined' ? self : globalThis);
