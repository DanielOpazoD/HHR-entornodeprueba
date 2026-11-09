/** HHR page ↔ worker relay for silent Exalab reconnection; replies carry booleans only. */
(() => {
  'use strict';
  if (!globalThis.HhrAppOrigins?.has(window.location.origin)) return;
  const TYPES = new Set(['HHR_EXALAB_SESSION_STATUS', 'HHR_EXALAB_AUTO_CONNECT', 'HHR_EXALAB_FORGET']);
  window.removeEventListener('message', globalThis.__hhrExalabAutoListener);
  window.addEventListener('message', (globalThis.__hhrExalabAutoListener = async event => {
    if (event.source !== window || event.origin !== window.location.origin || !TYPES.has(event.data?.type) ||
        typeof event.data.reqId !== 'string' || !chrome.runtime?.id) return;
    let result = null;
    try {
      result = await chrome.runtime.sendMessage({ type: event.data.type, pair: event.data.pair });
    } catch { /* An older/invalidated extension answers null; HHR keeps the manual flow. */ }
    window.postMessage({ type: event.data.type + '_RESULT', reqId: event.data.reqId, result }, window.location.origin);
  }));
  if (globalThis.__hhrExalabAvailableListener) chrome.runtime.onMessage.removeListener(globalThis.__hhrExalabAvailableListener);
  chrome.runtime.onMessage.addListener((globalThis.__hhrExalabAvailableListener = message => {
    if (message?.type === 'HHR_EXALAB_SESSION_AVAILABLE') {
      window.postMessage({ type: 'HHR_EXALAB_SESSION_AVAILABLE' }, window.location.origin);
    }
  }));
})();
