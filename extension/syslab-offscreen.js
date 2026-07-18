/**
 * Hidden transport between the service worker and Syslab's real browsing context.
 * The iframe owns the PHP session; this relay keeps no credentials or clinical payloads.
 */
(() => {
  'use strict';

  const FRAME_ORIGIN = 'http://10.4.69.90';
  const REQUEST_TARGET = 'hhr-syslab-offscreen';
  const FRAME_REQUEST = 'HHR_SYSLAB_FRAME_REQUEST';
  const FRAME_RESULT = 'HHR_SYSLAB_FRAME_RESULT';
  const frame = document.getElementById('hhr-syslab-frame');
  const pending = new Map();

  const requestFrameOnce = (message, timeoutMs) => new Promise((resolve, reject) => {
    if (!frame || !frame.contentWindow) {
      reject(new Error('No se pudo cargar la sesión interna de Syslab.'));
      return;
    }
    const reqId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('La sesión interna de Syslab todavía no responde.'));
    }, timeoutMs);
    pending.set(reqId, response => {
      window.clearTimeout(timeout);
      resolve(response);
    });
    frame.contentWindow.postMessage({
      type: FRAME_REQUEST,
      reqId,
      message,
    }, FRAME_ORIGIN);
  });

  const requestFrame = async (message, timeoutMs = 35_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = 'No se pudo iniciar la sesión interna de Syslab.';
    while (Date.now() < deadline) {
      try {
        return await requestFrameOnce(message, Math.max(250, deadline - Date.now()));
      } catch (error) {
        lastError = String((error && error.message) || error);
      }
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }
    throw new Error(lastError);
  };

  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== FRAME_ORIGIN) return;
    const data = event.data || {};
    if (data.type !== FRAME_RESULT || !pending.has(String(data.reqId || ''))) return;
    const resolve = pending.get(String(data.reqId));
    pending.delete(String(data.reqId));
    resolve(data.response || { error: 'Syslab no respondió a la solicitud.' });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.target !== REQUEST_TARGET) return undefined;
    requestFrame(message.request, Number(message.timeoutMs) || 35_000).then(
      response => sendResponse(response),
      error => sendResponse({ error: String((error && error.message) || error) })
    );
    return true;
  });
})();
