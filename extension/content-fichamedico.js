/**
 * content-fichamedico.js  (ISOLATED world, document_start)
 *
 * Relay on the Rayen Ficha Médico page. Bridges the background service worker
 * (chrome.runtime) and the MAIN-world reader (`inject-fichamedico.js`, a world:MAIN
 * content script) via window.postMessage, since the two cannot talk directly.
 */
(() => {
  'use strict';
  const runtimeMessages = globalThis.HhrRayenMessageContract &&
    globalThis.HhrRayenMessageContract.types;
  if (!runtimeMessages) return;

  // Diagnostic marker on the shared DOM so page-context checks can confirm this
  // ISOLATED content script actually injected on fichamedico.
  try {
    document.documentElement.setAttribute('data-rayen-relay', '1');
  } catch (_) {}

  const READ_TIMEOUT_MS = 45000;

  // El inject de mundo principal NO se reinyecta al recargar la extensión: una pestaña
  // ya abierta conserva el lector anterior (respondía «lista» y leía con código viejo).
  // Cada respuesta del inject trae su versión; si no coincide con la instalada, esta
  // pestaña no está lista ni para salud ni para lectura hasta recargarla (02-09).
  const extensionVersion = (() => {
    try {
      return String(chrome.runtime.getManifest().version || '');
    } catch (_) {
      return '';
    }
  })();
  const generationRelay = globalThis.HhrBridgeGeneration.createRelay({
    chromeApi: chrome,
    runtimeMessages,
    extensionVersion,
  });
  const runtimeContextPromise = generationRelay.context;
  const STALE_READER_MESSAGE =
    'Abre una pestaña nueva de Ficha Médico: esta pestaña pertenece a una versión o generación anterior de la extensión.';
  // Cada respuesta se valida sin convertir un mensaje aislado de la página en un estado
  // permanente: sólo la configuración MAIN inyectada directamente por Chrome fija la generación.
  const staleReader = (d, runtimeGeneration) => {
    return (
      Boolean(d && d.type) && (
        (Boolean(extensionVersion) && d.injectVersion !== extensionVersion) ||
        !runtimeGeneration ||
        !generationRelay.isCurrent(d, runtimeGeneration)
      )
    );
  };

  const readViaMainWorld = async () => {
    const runtimeContext = await runtimeContextPromise;
    const runtimeGeneration = runtimeContext && runtimeContext.runtimeGeneration;
    if (!runtimeGeneration) return { error: 'El relé de Ficha Médico perdió conexión con la extensión.' };
    return new Promise(resolve => {
      const reqId = 'r' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
      let settled = false;

      const onMessage = event => {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.type !== 'RAYEN_EXT_READ_RESULT' || d.reqId !== reqId) return;
        cleanup();
        if (staleReader(d, runtimeGeneration)) return resolve({ error: STALE_READER_MESSAGE });
        resolve(d.error ? { error: d.error } : { snapshot: d.snapshot });
      };

      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
      };

      window.addEventListener('message', onMessage);
      window.postMessage(
        { type: 'RAYEN_EXT_READ_REQUEST', reqId, runtimeGeneration },
        window.location.origin
      );

      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ error: 'Tiempo de espera agotado leyendo Rayen.' });
      }, READ_TIMEOUT_MS);
    });
  };

  // Generic request/response to the MAIN world over window.postMessage.
  const askMainWorld = async (requestType, resultType, timeoutMs = READ_TIMEOUT_MS) => {
    const runtimeContext = await runtimeContextPromise;
    const runtimeGeneration = runtimeContext && runtimeContext.runtimeGeneration;
    if (!runtimeGeneration) {
      return { error: 'El relé de Ficha Médico perdió conexión con la extensión.' };
    }
    return new Promise(resolve => {
      const reqId = 'r' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
      let settled = false;
      const onMessage = event => {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.type !== resultType || d.reqId !== reqId) return;
        cleanup();
        resolve({ ...d, requestedRuntimeGeneration: runtimeGeneration });
      };
      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
      };
      window.addEventListener('message', onMessage);
      window.postMessage({ type: requestType, reqId, runtimeGeneration }, window.location.origin);
      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ error: 'Tiempo de espera agotado (Ficha Médico).' });
      }, timeoutMs);
    });
  };

  const healthResponse = status => {
    const safeStatus = status || {};
    const outdated = staleReader(safeStatus, safeStatus.requestedRuntimeGeneration);
    const state = outdated ? 'outdated' : safeStatus.error ? 'unresponsive' :
      safeStatus.ready === true ? 'connected' : 'unavailable';
    const stateCopy = {
      outdated: { reason: 'outdated_tab', message: STALE_READER_MESSAGE },
      unresponsive: {
        reason: 'outdated_tab',
        message: 'Abre una pestaña nueva de Ficha Médico: el puente interno no respondió.',
      },
      connected: { reason: 'connected', message: safeStatus.message },
      unavailable: {
        reason: safeStatus.reason || 'session_expired',
        message: safeStatus.message || 'La sesión clínica de Ficha Médico no pudo verificarse.',
      },
    }[state];
    return {
      ready: state === 'connected',
      reason: stateCopy.reason,
      bridgeVersion: safeStatus.injectVersion,
      bridgeGeneration: safeStatus.bridgeGeneration,
      identity: safeStatus.identity || null,
      expiresAt: Number.isFinite(safeStatus.expiresAt) ? safeStatus.expiresAt : null,
      remainingSeconds: Number.isFinite(safeStatus.remainingSeconds)
        ? safeStatus.remainingSeconds : null,
      message: stateCopy.message,
    };
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'RAYEN_EXTENSION_HEALTH_PING') {
      askMainWorld(
        'RAYEN_FM_SESSION_STATUS_REQUEST',
        'RAYEN_FM_SESSION_STATUS_RESULT',
        4000
      ).then(status => sendResponse(healthResponse(status)));
      return true;
    }
    if (msg && msg.type === 'RAYEN_READ') {
      readViaMainWorld().then(sendResponse);
      return true; // keep the message channel open for the async response
    }
    if (msg && msg.type === 'RAYEN_FM_GET_FETCH_INFO') {
      askMainWorld('RAYEN_FM_FETCHINFO_REQUEST', 'RAYEN_FM_FETCHINFO_RESULT').then(d =>
        sendResponse(
          staleReader(d, d && d.requestedRuntimeGeneration)
            ? { error: STALE_READER_MESSAGE }
            : d.error ? { error: d.error } : { info: d.info }
        )
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
        type: isSave ? runtimeMessages.DEVICE_REPORT_SAVE : runtimeMessages.DEVICE_REPORT_REQUEST,
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
