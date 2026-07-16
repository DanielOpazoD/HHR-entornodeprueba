/**
 * content-fichamedico.js  (ISOLATED world, document_start)
 *
 * Relay on the Rayen Ficha Médico page. Bridges the background service worker
 * (chrome.runtime) and the MAIN-world reader (`inject-fichamedico.js`, a world:MAIN
 * content script) via window.postMessage, since the two cannot talk directly.
 */
(() => {
  'use strict';

  // Diagnostic marker on the shared DOM so page-context checks can confirm this
  // ISOLATED content script actually injected on fichamedico.
  try {
    document.documentElement.setAttribute('data-rayen-relay', '1');
  } catch (_) {}

  const READ_TIMEOUT_MS = 45000;

  const readViaMainWorld = () =>
    new Promise(resolve => {
      const reqId = 'r' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
      let settled = false;

      const onMessage = event => {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.type !== 'RAYEN_EXT_READ_RESULT' || d.reqId !== reqId) return;
        cleanup();
        resolve(d.error ? { error: d.error } : { snapshot: d.snapshot });
      };

      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
      };

      window.addEventListener('message', onMessage);
      window.postMessage({ type: 'RAYEN_EXT_READ_REQUEST', reqId }, window.location.origin);

      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ error: 'Tiempo de espera agotado leyendo Rayen.' });
      }, READ_TIMEOUT_MS);
    });

  // Generic request/response to the MAIN world over window.postMessage.
  const askMainWorld = (requestType, resultType, timeoutMs = READ_TIMEOUT_MS) =>
    new Promise(resolve => {
      const reqId = 'r' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
      let settled = false;
      const onMessage = event => {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.type !== resultType || d.reqId !== reqId) return;
        cleanup();
        resolve(d);
      };
      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
      };
      window.addEventListener('message', onMessage);
      window.postMessage({ type: requestType, reqId }, window.location.origin);
      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ error: 'Tiempo de espera agotado (Ficha Médico).' });
      }, timeoutMs);
    });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'RAYEN_EXTENSION_HEALTH_PING') {
      askMainWorld(
        'RAYEN_FM_SESSION_STATUS_REQUEST',
        'RAYEN_FM_SESSION_STATUS_RESULT',
        4000
      ).then(status =>
        sendResponse({
          ready: status && status.ready === true,
          identity: status && status.identity || null,
          message:
            (status && status.message) ||
            'La sesión clínica de Ficha Médico no pudo verificarse.',
        })
      );
      return true;
    }
    if (msg && msg.type === 'RAYEN_READ') {
      readViaMainWorld().then(sendResponse);
      return true; // keep the message channel open for the async response
    }
    if (msg && msg.type === 'RAYEN_FM_GET_FETCH_INFO') {
      askMainWorld('RAYEN_FM_FETCHINFO_REQUEST', 'RAYEN_FM_FETCHINFO_RESULT').then(d =>
        sendResponse(d.error ? { error: d.error } : { info: d.info })
      );
      return true;
    }
    return undefined;
  });

  // Diagnostic: let the page trigger a background device-report download/save end-to-end, so the
  // PDF fetch + parse can be verified from the Ficha Médico tab without an HHR tab open.
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || (d.type !== 'RAYEN_FM_TEST_DEVICE_SAVE' && d.type !== 'RAYEN_FM_TEST_DEVICE')) return;
    const isSave = d.type === 'RAYEN_FM_TEST_DEVICE_SAVE';
    chrome.runtime.sendMessage(
      {
        type: isSave ? 'RAYEN_DEVICE_REPORT_SAVE' : 'RAYEN_DEVICE_REPORT_REQUEST',
        encId: d.encId,
        fecha: d.fecha,
      },
      resp => {
        const err = chrome.runtime.lastError;
        window.postMessage(
          {
            type: isSave ? 'RAYEN_FM_TEST_DEVICE_SAVE_RESULT' : 'RAYEN_FM_TEST_DEVICE_RESULT',
            reqId: d.reqId,
            resp: err ? { error: err.message } : resp,
          },
          window.location.origin
        );
      }
    );
  });
})();
