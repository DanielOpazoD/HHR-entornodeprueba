/** Session-bound Syslab relay between the trusted HHR page and the extension worker. */
(() => {
  'use strict';

  const trustedOrigins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'https://testinghhr.netlify.app',
  ]);
  if (!trustedOrigins.has(window.location.origin)) return;

  const runtimeMessages = globalThis.HhrRayenMessageContract && globalThis.HhrRayenMessageContract.types;
  if (!runtimeMessages) return;

  const route = (resultType, runtimeType, payload = () => ({})) => ({ resultType, runtimeType, payload });
  const batchRoute = (resultType, runtimeType) => route(resultType, runtimeType, data => {
    const parsed = (Array.isArray(data.links) ? data.links : []).map(link => String(link).match(
      /^hhr-syslab-extension:\/\/batch\/([0-9a-f-]{36})\/exam\/(\d+)$/i
    ));
    const batchIds = new Set(parsed.filter(Boolean).map(match => match[1]));
    const isValid = parsed.length > 0 && parsed.length <= 24 &&
      !parsed.includes(null) && batchIds.size === 1;
    return {
      batchId: isValid ? parsed[0][1] : '',
      examIds: isValid ? parsed.map(match => match[2]) : [],
    };
  });
  const routes = {
    HHR_RAYEN_SYSLAB_STATUS_REQUEST: route(
      'HHR_RAYEN_SYSLAB_STATUS_RESULT', runtimeMessages.SYSLAB_STATUS_REQUEST
    ),
    HHR_RAYEN_SYSLAB_LOGIN_OPEN_REQUEST: route(
      'HHR_RAYEN_SYSLAB_LOGIN_OPEN_RESULT', runtimeMessages.SYSLAB_LOGIN_OPEN_REQUEST
    ),
    HHR_RAYEN_SYSLAB_SEARCH_REQUEST: route(
      'HHR_RAYEN_SYSLAB_SEARCH_RESULT', runtimeMessages.LAB_SEARCH_REQUEST,
      data => ({ rutBody: String(data.rutBody || '') })
    ),
    HHR_RAYEN_SYSLAB_DETAILS_REQUEST: batchRoute(
      'HHR_RAYEN_SYSLAB_DETAILS_RESULT', runtimeMessages.LAB_DETAILS_REQUEST
    ),
    HHR_RAYEN_SYSLAB_PDF_REQUEST: {
      resultType: 'HHR_RAYEN_SYSLAB_PDF_RESULT',
      runtimeType: runtimeMessages.LAB_PDF_OPEN_REQUEST,
      payload: data => {
        const match = String(data.link || '').match(
          /^hhr-syslab-extension:\/\/batch\/([0-9a-f-]{36})\/exam\/(\d+)$/i
        );
        return { batchId: match ? match[1] : '', examId: match ? match[2] : '' };
      },
    },
    HHR_RAYEN_SYSLAB_PDF_BUNDLE_REQUEST: batchRoute(
      'HHR_RAYEN_SYSLAB_PDF_BUNDLE_RESULT', runtimeMessages.LAB_PDF_BUNDLE_DOWNLOAD_REQUEST
    ),
  };

  const post = message => window.postMessage(message, window.location.origin);
  const errorMessage = error => /extension context invalidated/i.test(String(error))
    ? 'La extensión se actualizó. Recarga HHR y vuelve a intentarlo.'
    : 'No se pudo comunicar con la extensión Eloísa. Recarga HHR y vuelve a intentarlo.';

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    const route = data && routes[data.type];
    if (!route) return;

    Promise.resolve()
      .then(() => chrome.runtime.sendMessage({
        type: route.runtimeType,
        ...route.payload(data),
      }))
      .then(response => post({
        type: route.resultType,
        reqId: data.reqId,
        response,
      }))
      .catch(error => post({
        type: route.resultType,
        reqId: data.reqId,
        error: errorMessage(error),
      }));
  });
})();
