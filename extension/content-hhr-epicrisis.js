/** HHR page bridge for official hospitalization-report discovery and downloads. */
(() => {
  'use strict'; const runtimeMessages = globalThis.HhrRayenMessageContract && globalThis.HhrRayenMessageContract.types;
  const trustedOrigins = new Set(['http://localhost:3000', 'https://testinghhr.netlify.app']);
  if (!runtimeMessages || !trustedOrigins.has(window.location.origin)) return;
  const post = message => window.postMessage(message, window.location.origin);
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'HHR_RAYEN_EPICRISIS_DOWNLOAD_REQUEST') return;
    chrome.runtime.sendMessage({
      type: runtimeMessages.NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST,
      encId: data.encId,
      patientRun: data.patientRun,
      admissionDate: data.admissionDate, censusDate: data.censusDate,
      delivery: 'download',
      operation: data.operation,
      documentType: data.documentType,
    }).then(response => {
      post({
        type: 'HHR_RAYEN_EPICRISIS_DOWNLOAD_RESULT',
        reqId: data.reqId,
        ok: response && response.ok === true,
        episodes: response && Array.isArray(response.episodes) ? response.episodes : undefined,
        opened: response && response.opened === true,
        error: response && response.error,
      });
    }).catch(error => {
      console.warn('[Rayen→HHR] Epicrisis download error:', error);
      post({
        type: 'HHR_RAYEN_EPICRISIS_DOWNLOAD_RESULT',
        reqId: data.reqId,
        ok: false,
        error: String(error),
      });
    });
  });
})();
