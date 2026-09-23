'use strict';
(() => {
  const status = document.getElementById('worker-status');
  if (!status) return;
  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : null;
  const failed = () => {
    status.dataset.state = 'error';
    status.textContent =
      'El worker no responde. Recarga este puente en chrome://extensions; si persiste, desactívalo y actívalo.';
  };
  if (!runtime?.sendMessage) return failed();
  let timeout;
  Promise.race([
    Promise.resolve().then(() => runtime.sendMessage({ type: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST' })),
    new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('worker_timeout')), 5_000);
    }),
  ]).then(response => {
    if (response?.version !== runtime.getManifest().version || !response?.runtimeGeneration) {
      failed();
      return;
    }
    status.dataset.state = 'ready';
    status.textContent = 'Worker operativo · comprueba las sesiones de Ficha y Camas en HHR.';
  }).catch(failed).finally(() => clearTimeout(timeout));
})();
