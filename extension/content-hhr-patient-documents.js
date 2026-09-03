/** HHR page bridge for the Eloisa patient document manager. */
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
    if (!data || data.type !== 'HHR_RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST') return;
    chrome.runtime.sendMessage({
      type: runtimeMessages.PATIENT_DOCUMENT_MANAGER_REQUEST,
      encId: data.encId,
      operation: data.operation,
      routeHint: data.routeHint,
    }).then(response => {
      window.postMessage({
        type: 'HHR_RAYEN_PATIENT_DOCUMENT_MANAGER_RESULT',
        reqId: data.reqId,
        ok: response && response.ok === true,
        count: response && Number.isInteger(response.count) ? response.count : undefined,
        opened: response && response.opened === true,
        reused: response && response.reused === true,
        error: response && response.error,
      }, window.location.origin);
    }).catch(error => {
      console.warn('[Rayen→HHR] Patient document manager error:', error);
      window.postMessage({
        type: 'HHR_RAYEN_PATIENT_DOCUMENT_MANAGER_RESULT',
        reqId: data.reqId,
        ok: false,
        error: String(error),
      }, window.location.origin);
    });
  });
})();
