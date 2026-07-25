/** HHR page relay for the guarded Ficha Médico + Gestión de Camas capture. */
(() => {
  'use strict';

  const runtimeMessages = globalThis.HhrRayenMessageContract?.types;
  if (!runtimeMessages) return;
  const post = message => window.postMessage(message, window.location.origin);

  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.type !== 'HHR_RAYEN_REQUEST_SYNC_BUNDLE') return;
    const data = event.data;
    chrome.runtime
      .sendMessage({
        type: runtimeMessages.SYNC_BUNDLE_REQUEST,
        requestId: data.requestId,
        dateStart: data.dateStart,
        dateEnd: data.dateEnd,
      })
      .then(response => {
        if (response?.ok === true && response.snapshot && response.bundle) {
          post({
            type: 'HHR_RAYEN_CENSUS_SNAPSHOT',
            requestId: data.requestId,
            snapshot: response.snapshot,
            bundle: response.bundle,
          });
          return;
        }
        post({
          type: 'HHR_RAYEN_IMPORT_ERROR',
          requestId: data.requestId,
          error: response?.error || 'No se pudieron capturar ambas fuentes de Eloísa.',
        });
      })
      .catch(error => post({
        type: 'HHR_RAYEN_IMPORT_ERROR',
        requestId: data.requestId,
        error: String(error),
      }));
  });
})();
