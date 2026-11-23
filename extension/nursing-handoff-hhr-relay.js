(() => {
  'use strict';
  const origin = location.origin;
  if (origin !== 'https://hhr-hospitalizados.app' &&
      !/^https:\/\/(?:(?:deploy-preview-\d+--)?)testinghhr\.netlify\.app$/.test(origin)) return;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== origin ||
        event.data?.type !== 'HHR_NURSING_HANDOFF_LINK_RESULT' ||
        typeof event.data.requestId !== 'string') return;
    void chrome.runtime.sendMessage({
      type: 'RAYEN_NURSING_HANDOFF_EDITOR', action: 'hosted-result',
      id: event.data.requestId, expiresAt: event.data.expiresAt, registered: event.data.registered === true,
    }).catch(() => {});
  });
})();
