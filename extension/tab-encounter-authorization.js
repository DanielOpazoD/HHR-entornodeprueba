/** Short-lived exact-episode authorization scoped to one trusted HHR tab. */
(function (root) {
  'use strict';
  const create = ({ trustedOrigins, ttlMs = 5 * 60 * 1000 }) => {
    const authorizedByTab = new Map();
    const generationByTab = new Map();
    const trustedTabId = sender => {
      try {
        const origin = sender?.origin || new URL(sender?.url).origin;
        return Number.isInteger(sender?.tab?.id) && trustedOrigins.has(origin)
          ? sender.tab.id
          : null;
      } catch {
        return null;
      }
    };
    const authorizeResponse = async (sender, promise, selectItems) => {
      const tabId = trustedTabId(sender);
      const generation = tabId === null ? null : (generationByTab.get(tabId) || 0) + 1;
      if (tabId !== null) generationByTab.set(tabId, generation);
      const response = await promise;
      if (tabId === null || generationByTab.get(tabId) !== generation) return response;
      const items = selectItems(response);
      if (!Array.isArray(items)) {
        authorizedByTab.delete(tabId);
        return response;
      }
      const encounterIds = new Set(
        items.map(item => String(item?.encounterId || '')).filter(id => /^\d+$/.test(id))
      );
      authorizedByTab.set(tabId, { encounterIds, expiresAt: Date.now() + ttlMs });
      return response;
    };
    const add = (sender, encId) => {
      const tabId = trustedTabId(sender);
      const encounterId = String(encId || '');
      if (tabId === null || !/^\d+$/.test(encounterId)) return false;
      const current = authorizedByTab.get(tabId);
      const encounterIds = current?.expiresAt >= Date.now()
        ? new Set(current.encounterIds)
        : new Set();
      encounterIds.add(encounterId);
      authorizedByTab.set(tabId, { encounterIds, expiresAt: Date.now() + ttlMs });
      return true;
    };
    const has = (sender, encId) => {
      const tabId = trustedTabId(sender);
      if (tabId === null) return false;
      const current = authorizedByTab.get(tabId);
      if (!current || current.expiresAt < Date.now()) {
        authorizedByTab.delete(tabId);
        return false;
      }
      return current.encounterIds.has(String(encId || ''));
    };
    return Object.freeze({ add, authorizeResponse, has });
  };
  root.HhrTabEncounterAuthorization = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
