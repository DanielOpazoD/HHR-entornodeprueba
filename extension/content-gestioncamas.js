/**
 * content-gestioncamas.js  (ISOLATED world, document_start)
 *
 * Relay on the Eloísa Gestión de Camas page. Bridges the background service worker
 * (chrome.runtime) and the MAIN-world lookup (`inject-gestioncamas.js`) via
 * window.postMessage, since the two cannot talk directly.
 */
(() => {
  'use strict';

  const runtimeMessages = globalThis.HhrRayenMessageContract &&
    globalThis.HhrRayenMessageContract.types;
  if (!runtimeMessages) return;

  // Diagnostic marker so page-context checks can confirm this relay injected.
  try {
    document.documentElement.setAttribute('data-rayen-gc-relay', '1');
  } catch (_) {}

  const LOOKUP_TIMEOUT_MS = 45000;
  let connectionAttemptRevision = 0;

  const applyConnectionAttempt = (connectionAttemptId, rehydrated = false) => {
    connectionAttemptRevision += 1;
    window.postMessage(
      {
        type: 'RAYEN_GC_CONNECTION_ATTEMPT',
        connectionAttemptId: String(connectionAttemptId || ''),
        rehydrated: Boolean(rehydrated),
      },
      window.location.origin
    );
  };

  // Login redirects create a new MAIN-world document. Rehydrate the pending generation before
  // that document is asked for credentials, otherwise its captures would look stale.
  try {
    const requestedRevision = connectionAttemptRevision;
    chrome.runtime.sendMessage({ type: runtimeMessages.GC_DOCUMENT_READY }, response => {
      if (chrome.runtime.lastError) return;
      if (connectionAttemptRevision !== requestedRevision) return;
      applyConnectionAttempt(response && response.connectionAttemptId, true);
    });
  } catch (_error) {}

  const lookupViaMainWorld = runs =>
    new Promise(resolve => {
      const reqId = 'gc' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
      let settled = false;

      const onMessage = event => {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.type !== 'RAYEN_GC_LOOKUP_RESULT' || d.reqId !== reqId) return;
        cleanup();
        resolve(d.error ? { error: d.error } : { results: d.results });
      };

      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
      };

      window.addEventListener('message', onMessage);
      window.postMessage({ type: 'RAYEN_GC_LOOKUP_REQUEST', reqId, runs }, window.location.origin);

      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ error: 'Tiempo de espera agotado consultando Gestión de Camas.' });
      }, LOOKUP_TIMEOUT_MS);
    });

  // Ask the MAIN world for the captured auth token + API base so the background can download
  // reports (see inject-gestioncamas.js). Generic request/response over window.postMessage.
  const getFetchInfoViaMainWorld = connectionAttemptId =>
    new Promise(resolve => {
      const reqId = 'gc' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
      let settled = false;
      const onMessage = event => {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.type !== 'RAYEN_GC_FETCHINFO_RESULT' || d.reqId !== reqId) return;
        cleanup();
        resolve(
          d.error
            ? { error: d.error }
            : { info: { ...d.info, connectionAttemptId } }
        );
      };
      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
      };
      window.addEventListener('message', onMessage);
      window.postMessage(
        { type: 'RAYEN_GC_FETCHINFO_REQUEST', reqId, connectionAttemptId },
        window.location.origin
      );
      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ error: 'Tiempo de espera agotado obteniendo el token de Gestión de Camas.' });
      }, LOOKUP_TIMEOUT_MS);
    });

  // Persist only the short-lived access token in chrome.storage.session through the worker.
  // The password remains exclusively in Rayen's official login page.
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== runtimeMessages.GC_SESSION_CAPTURED || !data.info) return;
    try {
      chrome.runtime.sendMessage({ type: runtimeMessages.GC_SESSION_CAPTURED, info: data.info }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_error) {}
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'RAYEN_EXTENSION_HEALTH_PING') {
      sendResponse({ ready: true, message: 'Gestión de Camas disponible.' });
      return false;
    }
    if (msg && msg.type === 'RAYEN_GC_LOOKUP') {
      lookupViaMainWorld(Array.isArray(msg.runs) ? msg.runs : []).then(sendResponse);
      return true; // keep the message channel open for the async response
    }
    if (msg && msg.type === 'RAYEN_GC_GET_FETCH_INFO') {
      getFetchInfoViaMainWorld(String(msg.connectionAttemptId || '')).then(sendResponse);
      return true;
    }
    if (msg && msg.type === 'RAYEN_GC_SET_CONNECTION_ATTEMPT') {
      applyConnectionAttempt(msg.connectionAttemptId, msg.rehydrated === true);
      sendResponse({ ok: true });
      return false;
    }
    return undefined;
  });

  // Diagnostic: let the page (MAIN world) trigger a background report download/save end-to-end,
  // so the flow can be verified from the Gestión de Camas tab without needing an HHR tab open.
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || (d.type !== 'RAYEN_GC_TEST_REPORT' && d.type !== 'RAYEN_GC_TEST_SAVE')) return;
    const isSave = d.type === 'RAYEN_GC_TEST_SAVE';
    chrome.runtime.sendMessage(
      { type: isSave ? runtimeMessages.EGRESO_REPORT_SAVE : runtimeMessages.EGRESO_REPORT_REQUEST, dateStart: d.dateStart, dateEnd: d.dateEnd },
      resp => {
        const err = chrome.runtime.lastError;
        window.postMessage(
          {
            type: isSave ? 'RAYEN_GC_TEST_SAVE_RESULT' : 'RAYEN_GC_TEST_REPORT_RESULT',
            reqId: d.reqId,
            resp: err ? { error: err.message } : resp,
          },
          window.location.origin
        );
      }
    );
  });
})();
