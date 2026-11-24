(() => {
  'use strict';
  if (location.origin !== 'https://hhr-hospitalizados.app' || top !== window || globalThis.hhrClinicalChecklistRelayInstalled) return;
  globalThis.hhrClinicalChecklistRelayInstalled = true;
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'hhr-clinical-checklists' || port.sender?.id !== chrome.runtime.id) return;
    if (!document.documentElement?.hasAttribute('data-hhr-checklists-ready')) { port.postMessage({ unavailable: true }); return; }
    let pending = false;
    const requestId = crypto.randomUUID();
    const receive = event => {
      if (event.source === window && event.origin === location.origin && event.data?.type === 'HHR_CHECKLIST_RESPONSE' && event.data.requestId === requestId) {
        port.postMessage(event.data.error ? { error: event.data.error } : { data: event.data.data });
      }
    };
    port.onDisconnect.addListener(() => window.removeEventListener('message', receive));
    port.onMessage.addListener(request => {
      if (pending || !['templates', 'apply'].includes(request?.action)) return;
      pending = true;
      window.addEventListener('message', receive);
      window.postMessage({ type: 'HHR_CHECKLIST_REQUEST', requestId, request }, location.origin);
    });
    port.postMessage({ ready: true });
  });
})();
