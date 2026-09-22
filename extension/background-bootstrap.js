/** Keep startup failures observable even when an optional runtime cannot load. */
'use strict';

(() => {
  let initialized = false;
  const trustedOrigins = new Set([
    'https://fichamedico.rayensalud.cl',
    'https://hospitalizado.rayensalud.cl',
    'https://testinghhr.netlify.app',
    'http://localhost:3000',
    'http://localhost:3001',
  ]);
  const isTrustedSender = sender => {
    if (sender?.id !== chrome.runtime.id) return false;
    try {
      const url = new URL(sender.url || '');
      return trustedOrigins.has(url.origin) ||
        (url.protocol === 'chrome-extension:' && url.host === chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };
  const onStartupFailure = (message, sender, sendResponse) => {
    if (initialized || !isTrustedSender(sender) ||
        typeof message?.type !== 'string' || !message.type.startsWith('RAYEN_')) return;
    sendResponse({
      ok: false,
      errorCode: 'EXTENSION_STARTUP_FAILED',
      version: chrome.runtime.getManifest().version,
      error: 'La extensión no pudo iniciar sus módulos. Abre sus detalles en chrome://extensions, revisa Errores y vuelve a cargar la carpeta completa de la extensión. No se ejecutó esta solicitud.',
    });
    return false;
  };
  // Register synchronously before imports: a broken module must not look like a missing relay.
  chrome.runtime.onMessage.addListener(onStartupFailure);
  try {
    importScripts('background.js');
    initialized = true;
    chrome.runtime.onMessage.removeListener(onStartupFailure);
  } catch (_error) {
    // Keep the cause in local extension diagnostics; never send it to a web page.
    console.error('[Rayen→HHR] EXTENSION_STARTUP_FAILED: no se pudo cargar el runtime central.', _error);
  }
})();
