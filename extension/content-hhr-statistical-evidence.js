(() => {
  'use strict';
  const requestType = globalThis.HhrRayenMessageContract?.types
    ?.STATISTICAL_DISCHARGE_EVIDENCE_REQUEST;
  const trustedOrigins = new Set(['http://localhost:3000', 'http://localhost:3001',
    'https://testinghhr.netlify.app']);
  if (!requestType || !trustedOrigins.has(window.location.origin)) return;
  const resultType = 'HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT';
  const post = message => chrome.runtime?.id && window.postMessage(message, window.location.origin);
  window.addEventListener('message', event => {
    if (!chrome.runtime?.id || event.source !== window || event.origin !== window.location.origin ||
        event.data?.type !== 'HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST') return;
    Promise.resolve().then(() => chrome.runtime.sendMessage({ type: requestType, encId: event.data.encId }))
      .then(response => post({
        type: resultType,
        reqId: event.data.reqId,
        ok: response?.ok === true,
        base64: response?.base64,
        error: response?.error,
      }))
      .catch(error => {
        const message = String(error?.message || error || '');
        if (!chrome.runtime?.id) return;
        post({
          type: resultType,
          reqId: event.data.reqId,
          ok: false,
          error: message,
        });
      });
  });
})();
