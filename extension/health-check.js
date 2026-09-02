/** Pure helpers for the extension capability handshake (also exercised from Vitest). */
(function (root) {
  'use strict';

  const orderTabs = tabs =>
    (Array.isArray(tabs) ? tabs.slice() : []).sort((a, b) => {
      const activeDelta = Number(Boolean(b && b.active)) - Number(Boolean(a && a.active));
      if (activeDelta !== 0) return activeDelta;
      return Number((b && b.lastAccessed) || 0) - Number((a && a.lastAccessed) || 0);
    });

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
        message: response.message || 'Pestaña disponible.',
        ...(response.identity ? { identity: response.identity } : {}),
        ...expiry,
      },
    };
  };

  const probeTabs = async ({ tabs, sendMessage, missingMessage, staleMessage }) => {
    const ordered = orderTabs(tabs);
    if (ordered.length === 0) return { status: 'missing', message: missingMessage };
    let unavailableMessage = '';
    let firstReady = null;

    for (const tab of ordered) {
      if (!tab || tab.id == null) continue;
      try {
        const response = await sendMessage(tab.id, { type: 'RAYEN_EXTENSION_HEALTH_PING' });
        if (response && response.ready === true) {
          const ready = readyResult(response);
          // Un inject antiguo sobrevive a la recarga de la extensión hasta recargar
          // su página y responde «lista» sin vigencia; si otra pestaña la publica,
          // esa es la respuesta honesta (visto en vivo el 02-09 con dos pestañas).
          if (ready.publishesExpiry) return ready.result;
          firstReady = firstReady || ready.result;
          continue;
        }
        if (!unavailableMessage && response && response.message) {
          unavailableMessage = response.message;
        }
      } catch (_error) {
        // Try the next matching tab: another open tab may have the current relay injected.
      }
    }

    if (firstReady) return firstReady;
    return { status: 'stale', message: unavailableMessage || staleMessage };
  };

  root.HhrExtensionHealth = { orderTabs, probeTabs };
})(typeof self !== 'undefined' ? self : globalThis);
