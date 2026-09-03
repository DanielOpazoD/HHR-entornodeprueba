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

  // Sondea en paralelo las pestañas restantes y devuelve la primera (por preferencia)
  // lista que publica vigencia, o null.
  const pickExpiryPublisher = async (tabs, ping) => {
    const settled = await Promise.allSettled(tabs.map(ping));
    for (const outcome of settled) {
      const other = outcome.status === 'fulfilled' ? outcome.value : null;
      if (!other || other.ready !== true) continue;
      const ready = readyResult(other);
      if (ready.publishesExpiry) return ready.result;
    }
    return null;
  };

  const probeTabs = async ({ tabs, sendMessage, missingMessage, staleMessage }) => {
    const ordered = orderTabs(tabs);
    if (ordered.length === 0) return { status: 'missing', message: missingMessage };
    let unavailableMessage = '';
    const ping = tab => sendMessage(tab.id, { type: 'RAYEN_EXTENSION_HEALTH_PING' });

    for (let index = 0; index < ordered.length; index += 1) {
      const tab = ordered[index];
      if (!tab || tab.id == null) continue;
      try {
        const response = await ping(tab);
        if (response && response.ready === true) {
          const ready = readyResult(response);
          if (ready.publishesExpiry) return ready.result;
          // Heurística de transición (inject < 0.48.5, que respondía «lista» sin vigencia;
          // desde 0.48.8 el relay marca «no lista» un inject de otra versión): si otra
          // pestaña publica vigencia, esa es la respuesta honesta. Se sondean en paralelo
          // para acotar la espera a un solo tiempo de espera, no a uno por pestaña.
          const rest = ordered.slice(index + 1).filter(other => other && other.id != null);
          return (await pickExpiryPublisher(rest, ping)) || ready.result;
        }
        if (!unavailableMessage && response && response.message) {
          unavailableMessage = response.message;
        }
      } catch (_error) {
        // Try the next matching tab: another open tab may have the current relay injected.
      }
    }

    return { status: 'stale', message: unavailableMessage || staleMessage };
  };

  root.HhrExtensionHealth = { orderTabs, probeTabs };
})(typeof self !== 'undefined' ? self : globalThis);
