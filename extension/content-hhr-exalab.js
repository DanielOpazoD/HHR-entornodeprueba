(() => {
  'use strict';
  if (!globalThis.HhrAppOrigins?.has(window.location.origin)) return;
  window.removeEventListener('message', globalThis.__hhrExalabConnectListener);
  window.addEventListener('message', (globalThis.__hhrExalabConnectListener = async event => {
    if (event.source !== window || event.origin !== window.location.origin ||
        event.data?.type !== 'HHR_EXALAB_CONNECT_REQUEST' || !chrome.runtime?.id ||
        typeof event.data.reqId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(event.data.pair || '')) return;
    let opened = false;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'HHR_EXALAB_OPEN_CONNECT', pair: event.data.pair });
      opened = response?.opened === true;
    } catch { /* An older/invalidated extension returns only a bounded connection error. */ }
    window.postMessage({ type: 'HHR_EXALAB_CONNECT_RESULT', reqId: event.data.reqId, opened }, window.location.origin);
  }));
})();
