(() => {
  'use strict';
  const requestType = globalThis.HhrRayenMessageContract?.types
    ?.STATISTICAL_DISCHARGE_EVIDENCE_REQUEST;
  const trustedOrigins = new Set(['http://localhost:3000', 'http://localhost:3001',
    'https://testinghhr.netlify.app']);
  if (!requestType || !trustedOrigins.has(window.location.origin)) return;
  const resultType = 'HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT';
  const post = message => window.postMessage(message, window.location.origin);
  window.addEventListener('message', event => {
    if (event.source !== window ||
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
        post({
          type: resultType,
          reqId: event.data.reqId,
          ok: false,
          error: /extension context invalidated/i.test(message)
            ? 'La extensión se actualizó. Recarga la página HHR y vuelve a intentarlo.'
            : message,
        });
      });
  });
})();
