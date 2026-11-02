/**
 * Short-lived exact-episode authorization scoped to one trusted HHR tab.
 * Session storage survives worker sleep. Revocation fences pending captures and restores.
 * `has` stays synchronous and denies until `ready`: callers await it first.
 */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'hhrTabEncounterAuthorization';
  const create = ({ trustedOrigins, ttlMs = 5 * 60 * 1000, storage = root.chrome?.storage?.session }) => {
    const authorizedByTab = new Map();
    const generationByTab = new Map();
    const persist = () => {
      const stored = [...authorizedByTab].map(([tabId, { encounterIds, expiresAt }]) =>
        [tabId, { encounterIds: [...encounterIds], expiresAt }]);
      Promise.resolve(storage?.set({ [STORAGE_KEY]: stored })).catch(() => undefined);
    };
    const restore = async () => {
      const stored = (await storage?.get(STORAGE_KEY))?.[STORAGE_KEY];
      if (!Array.isArray(stored)) return;
      for (const [tabId, grant] of stored) {
        // A grant issued while this read was pending is newer than the stored one.
        if (grant?.expiresAt >= Date.now() && !authorizedByTab.has(tabId) && !generationByTab.has(tabId)) {
          authorizedByTab.set(tabId, { encounterIds: new Set(grant.encounterIds), expiresAt: grant.expiresAt });
        }
      }
    };
    const ready = restore().catch(() => undefined);
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
      const response = await promise; if (tabId === null || generationByTab.get(tabId) !== generation) return response;
      const items = selectItems(response);
      if (!Array.isArray(items)) {
        authorizedByTab.delete(tabId);
        persist();
        return response;
      }
      const encounterIds = new Set(items.map(item => String(item?.encounterId || '')).filter(id => /^\d+$/.test(id)));
      authorizedByTab.set(tabId, { encounterIds, expiresAt: Date.now() + ttlMs });
      persist();
      return response;
    };
    const add = (sender, encId) => {
      const tabId = trustedTabId(sender), encounterId = String(encId || '');
      if (tabId === null || !/^\d+$/.test(encounterId)) return false;
      const current = authorizedByTab.get(tabId);
      const encounterIds = current?.expiresAt >= Date.now() ? new Set(current.encounterIds) : new Set();
      encounterIds.add(encounterId);
      authorizedByTab.set(tabId, { encounterIds, expiresAt: Date.now() + ttlMs });
      persist();
      return true;
    };
    const has = (sender, encId) => {
      const tabId = trustedTabId(sender);
      if (tabId === null) return false;
      const current = authorizedByTab.get(tabId);
      if (!current || current.expiresAt < Date.now()) {
        authorizedByTab.delete(tabId);
        persist();
        return false;
      }
      return current.encounterIds.has(String(encId || ''));
    };
    const revoke = async sender => {
      const tabId = trustedTabId(sender); if (tabId === null) return false;
      generationByTab.set(tabId, (generationByTab.get(tabId) || 0) + 1);
      authorizedByTab.delete(tabId); await ready; persist(); return true;
    };
    const capture = sender => {
      const tabId = trustedTabId(sender), generation = generationByTab.get(tabId);
      return encId => generationByTab.get(tabId) === generation && add(sender, encId);
    };
    return Object.freeze({ add, capture, revoke, authorizeResponse, has, ready });
  };
  root.HhrTabEncounterAuthorization = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
