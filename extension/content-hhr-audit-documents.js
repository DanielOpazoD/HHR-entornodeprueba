/** HHR page bridge for the audit download of official Eloísa reports for a list of RUNs. */
(() => {
  'use strict';
  const runtimeMessages = globalThis.HhrRayenMessageContract && globalThis.HhrRayenMessageContract.types;
  if (!runtimeMessages || !globalThis.HhrAppOrigins?.has(window.location.origin)) return;
  const post = message => chrome.runtime?.id && window.postMessage(message, window.location.origin);

  // The worker sends the ZIP in parts; this relay saves it, so the PDFs never enter HHR's code.
  const parts = new Map();
  const saveArchive = (filename, chunks) => {
    const blob = new Blob(chunks.map(base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0))), {
      type: 'application/zip',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const receiveChunk = message => {
    const { requestId, index, total, filename, base64 } = message;
    if (typeof requestId !== 'string' || typeof base64 !== 'string' || typeof filename !== 'string' ||
      !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total) {
      return { error: 'Parte del ZIP no válida.' };
    }
    const received = index === 0 ? [] : parts.get(requestId);
    if (!received || received.length !== index) {
      parts.delete(requestId);
      return { error: 'Las partes del ZIP llegaron desordenadas.' };
    }
    received.push(base64);
    if (index < total - 1) {
      parts.set(requestId, received);
      return { ok: true };
    }
    parts.delete(requestId);
    saveArchive(filename, received);
    return { ok: true, saved: true };
  };

  chrome.runtime.onMessage.removeListener(globalThis.__hhrAuditDocumentsProgressListener);
  chrome.runtime.onMessage.addListener((globalThis.__hhrAuditDocumentsProgressListener = (message, _sender, sendResponse) => {
    if (message && message.type === runtimeMessages.AUDIT_DOCUMENTS_FILE_CHUNK) {
      try {
        sendResponse(receiveChunk(message));
      } catch (error) {
        sendResponse({ error: String((error && error.message) || error) });
      }
      return undefined;
    }
    if (!message || message.type !== runtimeMessages.AUDIT_DOCUMENTS_PROGRESS) return undefined;
    post({
      type: 'HHR_RAYEN_AUDIT_DOCUMENTS_PROGRESS',
      reqId: message.requestId,
      phase: message.phase,
      done: message.done,
      total: message.total,
    });
    return undefined;
  }));

  window.removeEventListener('message', globalThis.__hhrAuditDocumentsRelayListener);
  window.addEventListener('message', (globalThis.__hhrAuditDocumentsRelayListener = event => {
    if (!chrome.runtime?.id || event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (data?.type === 'HHR_RAYEN_AUDIT_DOCUMENTS_CANCEL') {
      if (typeof data.reqId !== 'string' || !data.reqId) return;
      chrome.runtime
        .sendMessage({ type: runtimeMessages.AUDIT_DOCUMENTS_CANCEL, requestId: data.reqId })
        .catch(() => undefined);
      return;
    }
    if (data?.type !== 'HHR_RAYEN_AUDIT_DOCUMENTS_REQUEST') return;
    // Acknowledged at once, so HHR can tell an outdated extension from a slow download.
    post({ type: 'HHR_RAYEN_AUDIT_DOCUMENTS_PROGRESS', reqId: data.reqId, phase: 'accepted', done: 0, total: 0 });
    chrome.runtime.sendMessage({
      type: runtimeMessages.AUDIT_DOCUMENTS_REQUEST,
      requestId: data.reqId,
      patients: data.patients,
      documentTypes: data.documentTypes,
    }).then(response => {
      if (response?.cancelled === true) return;
      post({
        type: 'HHR_RAYEN_AUDIT_DOCUMENTS_RESULT',
        reqId: data.reqId,
        ok: response?.ok === true,
        filename: response?.filename,
        documentCount: response?.documentCount,
        failedCount: response?.failedCount,
        summary: Array.isArray(response?.summary) ? response.summary : undefined,
        error: response?.error,
      });
    }).catch(error => {
      console.warn('[Rayen→HHR] Audit documents error:', error);
      post({ type: 'HHR_RAYEN_AUDIT_DOCUMENTS_RESULT', reqId: data.reqId, ok: false, error: String(error) });
    });
  }));
})();
