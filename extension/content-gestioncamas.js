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
  const previousRelay = globalThis.__hhrGestionCamasRelayInstalled; if (previousRelay?.runtime === chrome.runtime && previousRelay.runtimeId === chrome.runtime.id) return;
  try {
    chrome.runtime.onMessage.removeListener?.(previousRelay?.runtimeListener);
    window.removeEventListener('message', previousRelay?.pageListener);
  } catch (_) {}
  const relayClaim = { runtime: chrome.runtime, runtimeId: chrome.runtime.id };
  globalThis.__hhrGestionCamasRelayInstalled = relayClaim;
  const ownsRelay = () => globalThis.__hhrGestionCamasRelayInstalled === relayClaim;
  // Diagnostic marker so page-context checks can confirm this relay injected.
  try {
    document.documentElement.setAttribute('data-rayen-gc-relay', '1');
  } catch (_) {}

  const LOOKUP_TIMEOUT_MS = 45000;
  let connectionAttemptRevision = 0;
  const extensionVersion = chrome.runtime.getManifest().version;
  const generationRelay = globalThis.HhrBridgeGeneration.createRelay({
    chromeApi: chrome,
    runtimeMessages,
    extensionVersion,
  });
  const getRuntimeContext = generationRelay.getContext;
  const isCurrentBridgeMessage = generationRelay.isCurrent;
  const bridgeHealth = globalThis.HhrGestionCamasBridgeHealth.create({
    windowRef: window,
    getRuntimeContext,
    isCurrentBridgeMessage,
  });

  const applyConnectionAttempt = (connectionAttemptId, runtimeGeneration, rehydrated = false) => {
    connectionAttemptRevision += 1;
    window.postMessage(
      {
        type: 'RAYEN_GC_CONNECTION_ATTEMPT',
        connectionAttemptId: String(connectionAttemptId || ''),
        runtimeGeneration,
        rehydrated: Boolean(rehydrated),
      },
      window.location.origin
    );
  };

  // Login redirects create a new MAIN-world document. Rehydrate the pending generation before
  // that document is asked for credentials, otherwise its captures would look stale.
  void getRuntimeContext().then(runtimeContext => {
    if (!runtimeContext || !ownsRelay()) return;
    try {
      const requestedRevision = connectionAttemptRevision;
      chrome.runtime.sendMessage({ type: runtimeMessages.GC_DOCUMENT_READY }, response => {
        if (chrome.runtime.lastError || !ownsRelay()) return;
        if (connectionAttemptRevision !== requestedRevision) return;
        applyConnectionAttempt(
          response && response.connectionAttemptId,
          runtimeContext.runtimeGeneration,
          true
        );
      });
    } catch (_error) {}
  });

  const lookupViaMainWorld = async runs => {
    const runtimeContext = await getRuntimeContext();
    const runtimeGeneration = runtimeContext && runtimeContext.runtimeGeneration;
    if (!runtimeGeneration) return { error: 'El relé de Gestión de Camas perdió conexión con la extensión.' };
    return new Promise(resolve => {
      const reqId = 'gc' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
      let settled = false;

      const onMessage = event => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const d = event.data;
        if (!d || d.type !== 'RAYEN_GC_LOOKUP_RESULT' || d.reqId !== reqId) return;
        cleanup();
        if (!isCurrentBridgeMessage(d, runtimeGeneration)) {
          resolve({ error: 'Abre una pestaña nueva de Gestión de Camas: la pestaña actual está desactualizada.' });
          return;
        }
        resolve(d.error ? { error: d.error } : { results: d.results });
      };

      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
      };

      window.addEventListener('message', onMessage);
      window.postMessage(
        { type: 'RAYEN_GC_LOOKUP_REQUEST', reqId, runs, runtimeGeneration },
        window.location.origin
      );

      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ error: 'Tiempo de espera agotado consultando Gestión de Camas.' });
      }, LOOKUP_TIMEOUT_MS);
    });
  };

  // Ask the MAIN world for the captured auth token + API base so the background can download
  // reports (see inject-gestioncamas.js). Generic request/response over window.postMessage.
  const getFetchInfoViaMainWorld = async connectionAttemptId => {
    const runtimeContext = await getRuntimeContext();
    const runtimeGeneration = runtimeContext && runtimeContext.runtimeGeneration;
    if (!runtimeGeneration) return { error: 'El relé de Gestión de Camas perdió conexión con la extensión.' };
    return new Promise(resolve => {
      const reqId = 'gc' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
      let settled = false;
      const onMessage = event => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const d = event.data;
        if (!d || d.type !== 'RAYEN_GC_FETCHINFO_RESULT' || d.reqId !== reqId) return;
        cleanup();
        if (!isCurrentBridgeMessage(d, runtimeGeneration)) {
          resolve({ error: 'Abre una pestaña nueva de Gestión de Camas: la pestaña actual está desactualizada.' });
          return;
        }
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
        { type: 'RAYEN_GC_FETCHINFO_REQUEST', reqId, connectionAttemptId, runtimeGeneration },
        window.location.origin
      );
      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ error: 'Tiempo de espera agotado obteniendo el token de Gestión de Camas.' });
      }, LOOKUP_TIMEOUT_MS);
    });
  };

  // Persist only the short-lived access token in chrome.storage.session through the worker.
  // The password remains exclusively in Rayen's official login page.
  const onPageMessage = async event => {
    if (!ownsRelay()) return;
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== runtimeMessages.GC_SESSION_CAPTURED || !data.info) return;
    const runtimeContext = await getRuntimeContext();
    if (
      !runtimeContext ||
      !isCurrentBridgeMessage(data, runtimeContext.runtimeGeneration)
    ) return;
    try {
      chrome.runtime.sendMessage({ type: runtimeMessages.GC_SESSION_CAPTURED, info: data.info }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_error) {}
  };
  window.addEventListener('message', onPageMessage);

  const onRuntimeMessage = (msg, _sender, sendResponse) => {
    if (!ownsRelay()) return undefined;
    if (msg && msg.type === 'RAYEN_EXTENSION_HEALTH_PING') {
      bridgeHealth.read().then(sendResponse);
      return true;
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
      getRuntimeContext().then(runtimeContext => {
        if (!runtimeContext) {
          sendResponse({ error: 'El relé perdió conexión con la extensión.' });
          return;
        }
        applyConnectionAttempt(
          msg.connectionAttemptId,
          runtimeContext.runtimeGeneration,
          msg.rehydrated === true
        );
        sendResponse({ ok: true });
      });
      return true;
    }
    return undefined;
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  Object.assign(relayClaim, { runtimeListener: onRuntimeMessage, pageListener: onPageMessage });
})();
