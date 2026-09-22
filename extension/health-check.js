(function (root) {
  'use strict';
  const PREFERRED_TAB_STORAGE_KEY = 'hhrFichaMedicoPreferredTabV1';
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
  const createTabPreference = sessionStorage => {
    const read = async () => {
      if (typeof sessionStorage?.get !== 'function') return null;
      const stored = await sessionStorage.get(PREFERRED_TAB_STORAGE_KEY).catch(() => ({}));
      const tabId = Number(stored && stored[PREFERRED_TAB_STORAGE_KEY]);
      return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
    };
    const remember = tabId => typeof sessionStorage?.set === 'function'
      ? sessionStorage.set({ [PREFERRED_TAB_STORAGE_KEY]: Number(tabId) }).catch(() => {})
      : Promise.resolve();
    const forget = async expected => {
      if (typeof sessionStorage?.remove !== 'function' || await read() !== Number(expected)) return;
      await sessionStorage.remove(PREFERRED_TAB_STORAGE_KEY).catch(() => {});
    };
    const prioritize = async tabs => {
      const preferred = await read();
      if (preferred == null) return tabs;
      const index = tabs.findIndex(tab => Number(tab?.id) === preferred);
      if (index < 0) { await forget(preferred); return tabs; }
      return [tabs[index], ...tabs.slice(0, index), ...tabs.slice(index + 1)];
    };
    return { prioritize, remember, forget };
  };
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
      result: { status: 'ready', reason: 'connected', message: response.message || 'Pestaña disponible.',
        ...(response.identity ? { identity: response.identity } : {}),
        ...(response.bridgeVersion ? { bridgeVersion: response.bridgeVersion } : {}),
        ...(response.bridgeGeneration ? { bridgeGeneration: response.bridgeGeneration } : {}),
        ...expiry },
    };
  };
  const resolveReady = (readyOutcomes, preferExpiryPublisher) => {
    if (preferExpiryPublisher) {
      const publisher = readyOutcomes.find(ready => ready.publishesExpiry);
      if (publisher) return publisher.result;
    }
    return readyOutcomes[0].result;
  };
  const probeTabs = async ({ tabs, sendMessage, missingMessage, staleMessage,
    preferExpiryPublisher = false, healthMessage = { type: 'RAYEN_EXTENSION_HEALTH_PING' } }) => {
    const ordered = orderTabs(tabs);
    if (ordered.length === 0) {
      return { status: 'missing', reason: 'tab_missing', message: missingMessage };
    }
    let unavailableMessage = '';
    let unavailableReason = '';
    const ping = tab => sendMessage(tab.id, healthMessage);

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
    return { status: 'stale', reason: unavailableReason || 'relay_disconnected',
      message: unavailableMessage || staleMessage };
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
      healthMessage: { type: 'RAYEN_EXTENSION_HHR_HEALTH_PING',
        runtimeGeneration: runtimeContext.runtimeGeneration },
    }));
  root.HhrExtensionHealth = {
    orderTabs, resolveTabs, probeTabs, createHhrProbe, createTabPreference,
    PREFERRED_TAB_STORAGE_KEY,
  };
})(typeof self !== 'undefined' ? self : globalThis);
