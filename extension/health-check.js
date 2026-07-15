/** Pure helpers for the extension capability handshake (also exercised from Vitest). */
(function (root) {
  'use strict';

  const orderTabs = tabs =>
    (Array.isArray(tabs) ? tabs.slice() : []).sort((a, b) => {
      const activeDelta = Number(Boolean(b && b.active)) - Number(Boolean(a && a.active));
      if (activeDelta !== 0) return activeDelta;
      return Number((b && b.lastAccessed) || 0) - Number((a && a.lastAccessed) || 0);
    });

  const probeTabs = async ({ tabs, sendMessage, missingMessage, staleMessage }) => {
    const ordered = orderTabs(tabs);
    if (ordered.length === 0) return { status: 'missing', message: missingMessage };
    let unavailableMessage = staleMessage;

    for (const tab of ordered) {
      if (!tab || tab.id == null) continue;
      try {
        const response = await sendMessage(tab.id, { type: 'RAYEN_EXTENSION_HEALTH_PING' });
        if (response && response.ready === true) {
          return {
            status: 'ready',
            message: response.message || 'Pestaña disponible.',
            ...(response.identity ? { identity: response.identity } : {}),
          };
        }
        if (response && response.message) unavailableMessage = response.message;
      } catch (_error) {
        // Try the next matching tab: another open tab may have the current relay injected.
      }
    }

    return { status: 'stale', message: unavailableMessage };
  };

  root.HhrExtensionHealth = { orderTabs, probeTabs };
})(typeof self !== 'undefined' ? self : globalThis);
