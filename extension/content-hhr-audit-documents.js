/** HHR page bridge for the audit download of official Eloísa reports for a list of RUNs. */
(() => {
  'use strict';
  const runtimeMessages = globalThis.HhrRayenMessageContract && globalThis.HhrRayenMessageContract.types;
  if (!runtimeMessages || !globalThis.HhrAppOrigins?.has(window.location.origin)) return;
  const post = message => chrome.runtime?.id && window.postMessage(message, window.location.origin);

  // The worker sends the ZIP in parts. A screen that saves it itself (where the person chooses)
  // gets the joined Blob; an older one gets it saved straight into Downloads.
  const parts = new Map();
  const savedByPage = new Set();
  const joinArchive = chunks => new Blob(chunks.map(base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0))), {
    type: 'application/zip',
  });
  const saveArchive = (filename, chunks) => {
    const url = URL.createObjectURL(joinArchive(chunks));
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
    if (message.discard === true) {
      parts.delete(requestId);
      savedByPage.delete(requestId);
      return { ok: true };
    }
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
    if (savedByPage.delete(requestId)) {
      post({ type: 'HHR_RAYEN_AUDIT_DOCUMENTS_ARCHIVE', reqId: requestId, filename, blob: joinArchive(received) });
      return { ok: true, saved: true };
    }
    saveArchive(filename, received);
    return { ok: true, saved: true };
  };

  // Chrome rejects removeListener(undefined), which is the case on the first injection.
  try {
    if (globalThis.__hhrAuditDocumentsProgressListener) {
      chrome.runtime.onMessage.removeListener(globalThis.__hhrAuditDocumentsProgressListener);
    }
  } catch (_error) {}
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
    if (data.saveInPage === true && typeof data.reqId === 'string') savedByPage.add(data.reqId);
    // Acknowledged at once, so HHR can tell an outdated extension from a slow download.
    post({ type: 'HHR_RAYEN_AUDIT_DOCUMENTS_PROGRESS', reqId: data.reqId, phase: 'accepted', done: 0, total: 0 });
    chrome.runtime.sendMessage({
      type: runtimeMessages.AUDIT_DOCUMENTS_REQUEST,
      requestId: data.reqId,
      patients: data.patients,
      documentTypes: data.documentTypes,
    }).then(response => {
      savedByPage.delete(data.reqId);
      if (response?.cancelled === true) {
        // Also stopped by a session change elsewhere: the screen must not wait for its timer.
        post({ type: 'HHR_RAYEN_AUDIT_DOCUMENTS_RESULT', reqId: data.reqId, ok: false, cancelled: true, error: response.error });
        return;
      }
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
      savedByPage.delete(data.reqId);
      console.warn('[Rayen→HHR] Audit documents error:', error);
      post({ type: 'HHR_RAYEN_AUDIT_DOCUMENTS_RESULT', reqId: data.reqId, ok: false, error: String(error) });
    });
  }));
})();
