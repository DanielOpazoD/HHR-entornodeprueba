/** Open a consent page; no Exalab credentials enter the HHR page or worker messages. */
(() => {
  'use strict';
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'HHR_EXALAB_OPEN_CONNECT') return undefined;
    if (!self.HhrAppOrigins.matchesUrl(sender?.tab?.url) || sender.frameId !== 0 ||
        !/^[A-Za-z0-9_-]{43}$/.test(message.pair || '')) {
      sendResponse({ opened: false }); return undefined;
    }
    const origin = new URL(sender.tab.url).origin;
    const hash = new URLSearchParams({ pair: message.pair, origin });
    void (async () => {
      try {
        await chrome.tabs.create({ url: chrome.runtime.getURL('exalab-connect.html') + '#' + hash, openerTabId: sender.tab.id });
        sendResponse({ opened: true });
      } catch { sendResponse({ opened: false }); }
    })();
    return true;
  });
})();
