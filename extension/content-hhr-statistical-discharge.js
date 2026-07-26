(() => {
  'use strict';
  const runtimeMessages = globalThis.HhrRayenMessageContract?.types;
  const trustedOrigins = new Set(['http://localhost:3000', 'http://localhost:3001', 'https://testinghhr.netlify.app']);
  if (!runtimeMessages || !trustedOrigins.has(window.location.origin)) return;
  const post = message => window.postMessage(message, window.location.origin);
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.type !== 'HHR_RAYEN_STATISTICAL_DISCHARGE_DOWNLOAD_REQUEST') return;
    Promise.resolve().then(() => chrome.runtime.sendMessage({
      type: runtimeMessages.STATISTICAL_DISCHARGE_REPORT_REQUEST,
      encId: event.data.encId,
    })).then(response => post({
      type: 'HHR_RAYEN_STATISTICAL_DISCHARGE_DOWNLOAD_RESULT',
      reqId: event.data.reqId,
      ok: response && response.ok === true,
      error: response && response.error,
    })).catch(error => {
      const errorMessage = String(error && error.message ? error.message : error || '');
      post({
        type: 'HHR_RAYEN_STATISTICAL_DISCHARGE_DOWNLOAD_RESULT',
        reqId: event.data.reqId,
        ok: false,
        error: /extension context invalidated/i.test(errorMessage)
          ? 'La extensión se actualizó. Recarga la página HHR y vuelve a intentarlo.'
          : errorMessage,
      });
    });
  });
})();
