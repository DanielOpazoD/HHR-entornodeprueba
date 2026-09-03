/** HHR page bridge for opening one authorized Eloisa patient document. */
(() => {
  'use strict';
  const runtimeMessages = globalThis.HhrRayenMessageContract &&
    globalThis.HhrRayenMessageContract.types;
  const trustedOrigins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'https://testinghhr.netlify.app',
    'https://hhr-entornodeprueba.vercel.app',
  ]);
  if (!runtimeMessages || !trustedOrigins.has(window.location.origin)) return;

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'HHR_RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST') return;
    chrome.runtime.sendMessage({
      type: runtimeMessages.PATIENT_DOCUMENT_MANAGER_REQUEST,
      encId: data.encId,
      operation: 'open-document',
      documentId: data.documentId,
    }).then(response => {
      window.postMessage({
        type: 'HHR_RAYEN_PATIENT_DOCUMENT_OPEN_RESULT',
        reqId: data.reqId,
        ok: response && response.ok === true,
        opened: response && response.opened === true,
        error: response && response.error,
      }, window.location.origin);
    }).catch(error => {
      console.warn('[Rayen→HHR] Patient document open error:', error);
      window.postMessage({
        type: 'HHR_RAYEN_PATIENT_DOCUMENT_OPEN_RESULT',
        reqId: data.reqId,
        ok: false,
        opened: false,
        error: String(error),
      }, window.location.origin);
    });
  });
})();
