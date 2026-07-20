/** HHR page bridge for exact statistical-discharge PDF downloads. */
(() => {
  'use strict';
  const runtimeMessages = globalThis.HhrRayenMessageContract?.types;
  const trustedOrigins = new Set(['http://localhost:3000', 'https://testinghhr.netlify.app']);
  if (!runtimeMessages || !trustedOrigins.has(window.location.origin)) return;
  const post = message => window.postMessage(message, window.location.origin);
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'HHR_RAYEN_STATISTICAL_DISCHARGE_DOWNLOAD_REQUEST') return;
    chrome.runtime.sendMessage({
      type: runtimeMessages.STATISTICAL_DISCHARGE_REPORT_REQUEST,
      encId: data.encId,
    }).then(response => post({
      type: 'HHR_RAYEN_STATISTICAL_DISCHARGE_DOWNLOAD_RESULT',
      reqId: data.reqId,
      ok: response && response.ok === true,
      error: response && response.error,
    })).catch(error => {
      console.warn('[Rayen→HHR] Statistical discharge download error:', error);
      post({
        type: 'HHR_RAYEN_STATISTICAL_DISCHARGE_DOWNLOAD_RESULT',
        reqId: data.reqId,
        ok: false,
        error: String(error),
      });
    });
  });
})();
