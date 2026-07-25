/** HHR page bridge for the official Ficha Médico patient-flow PDF. */
(() => {
  'use strict';

  const runtimeMessages = globalThis.HhrRayenMessageContract &&
    globalThis.HhrRayenMessageContract.types;
  const trustedOrigins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'https://testinghhr.netlify.app',
  ]);
  if (!runtimeMessages || !trustedOrigins.has(window.location.origin)) return;

  const post = message => window.postMessage(message, window.location.origin);

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== 'HHR_RAYEN_PATIENT_FLOW_REQUEST') return;
    const reqId = data.reqId;
    chrome.runtime
      .sendMessage({ type: runtimeMessages.PATIENT_FLOW_REPORT_REQUEST, encId: data.encId })
      .then(response => {
        post({
          type: 'HHR_RAYEN_PATIENT_FLOW_RESULT',
          reqId,
          base64: response && response.base64 || '',
          error: response && response.error,
        });
      })
      .catch(error => {
        post({
          type: 'HHR_RAYEN_PATIENT_FLOW_RESULT',
          reqId,
          base64: '',
          error: String(error),
        });
      });
  });
})();
