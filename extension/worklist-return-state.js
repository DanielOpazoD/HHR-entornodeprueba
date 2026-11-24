/** One pending return per tab. Chrome keeps session storage in memory across MV3 restarts. */
(() => {
  'use strict';
  const keyFor = tabId => 'hhr-worklist-return-' + tabId;
  const operations = new Map();
  // Chrome storage has no compare-and-delete. Order the small number of
  // operations within one tab so a late dismissal cannot erase a newer visit.
  const inTab = (tabId, operation) => {
    const next = (operations.get(tabId) || Promise.resolve()).then(operation, operation);
    operations.set(tabId, next);
    return next.finally(() => { if (operations.get(tabId) === next) operations.delete(tabId); });
  };
  const listPath = raw => {
    try {
      const url = new URL(raw);
      const path = url.pathname.replace(/\/$/, '');
      return url.origin === 'https://fichamedico.rayensalud.cl' && /^\/dashboard\/encounter-list(?:-nurse)?$/.test(path) ? path : '';
    } catch { return ''; }
  };

  const apply = async (message, key, path) => {
    if (message.action === 'remember') {
      const s = message.snapshot;
      if (!s || typeof s.entryKey !== 'string' || typeof s.episode !== 'string' ||
          !/^[\w-]{1,80}$/.test(s.entryKey) || !/^[1-9]\d{0,15}$/.test(s.episode) ||
          typeof s.query !== 'string' || s.query.length > 512 || typeof s.tab !== 'string' || s.tab.length > 100 ||
          typeof s.referral !== 'string' || s.referral.length > 128 ||
          ![s.windowY, s.scrollTop, s.rowTop].every(Number.isFinite)) return {};
      const { entryKey, episode, query, tab, referral, windowY, scrollTop, rowTop } = s;
      await chrome.storage.session.set({ [key]: { receipt: crypto.randomUUID(), path, entryKey, episode, query, tab, referral, windowY, scrollTop, rowTop } });
      return {};
    }
    if (message.action === 'finish') {
      const s = (await chrome.storage.session.get(key))[key];
      if (s?.path === path && s.receipt === message.receipt) await chrome.storage.session.remove(key);
      return {};
    }
    if (message.action !== 'return') return {};
    const s = (await chrome.storage.session.get(key))[key];
    if (!s || s.path !== path || !Array.isArray(message.entryKeys) || !message.entryKeys.includes(s.entryKey) ||
        (message.fromEpisode && message.fromEpisode !== s.episode)) return {};
    return { snapshot: s };
  };
  const handle = async (message, sender) => {
    const path = listPath(sender?.url);
    const tabId = sender?.tab?.id;
    if (!path || sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(tabId)) return {};
    return inTab(tabId, () => apply(message, keyFor(tabId), path));
  };
  const clearTab = tabId => inTab(tabId, () => chrome.storage.session.remove(keyFor(tabId)));
  chrome.tabs.onUpdated?.addListener((tabId, { url }) => {
    if (url && !/^https:\/\/fichamedico\.rayensalud\.cl\/dashboard\/encounter-list(?:-nurse)?(?:\/[1-9]\d*)?\/?(?:[?#]|$)/.test(url)) return clearTab(tabId);
  });
  chrome.tabs.onRemoved?.addListener(clearTab);
  self.HhrWorklistReturnState = Object.freeze({ handle });
})();
