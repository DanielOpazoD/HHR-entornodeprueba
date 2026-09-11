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
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (data && data.type === 'HHR_RAYEN_CLINICAL_ACTION_REQUEST') {
      const request = data.operation === 'prescription'
        ? { type: runtimeMessages.PRESCRIPTION_PRINT_REQUEST, encId: data.encId, selectionKey: 'complete' }
        : ['list', 'detail', 'attachment', 'urgency'].includes(data.operation)
          ? { type: runtimeMessages.CLINICAL_ANTECEDENTS_REQUEST, encId: data.encId, operation: data.operation, entryId: data.entryId }
          : null;
      if (!request) return;
      chrome.runtime.sendMessage(request).then(response => {
        window.postMessage({ ...response, opened: response?.opened === true || (data.operation === 'prescription' && response?.ok === true && Number.isInteger(response.printTabId)), type: 'HHR_RAYEN_CLINICAL_ACTION_RESULT', reqId: data.reqId }, window.location.origin);
      }).catch(() => {
        window.postMessage({ type: 'HHR_RAYEN_CLINICAL_ACTION_RESULT', reqId: data.reqId, ok: false, error: 'No se pudo conectar con la extensión Eloísa. Recárgala y vuelve a intentar.' }, window.location.origin);
      });
      return;
    }
    if (!data || data.type !== 'HHR_RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST') return;
    const postDocument = response => window.postMessage({ type: 'HHR_RAYEN_PATIENT_DOCUMENT_OPEN_RESULT', reqId: data.reqId, ok: response?.ok === true, opened: response?.opened === true, error: response?.error }, window.location.origin);
    chrome.runtime.sendMessage({ type: runtimeMessages.PATIENT_DOCUMENT_MANAGER_REQUEST, encId: data.encId, operation: 'open-document', documentId: data.documentId })
      .then(postDocument).catch(() => postDocument({ ok: false, opened: false, error: 'No se pudo conectar con la extensión Eloísa.' }));
  });
})();
