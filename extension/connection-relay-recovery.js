/** Shared, side-effect-free lifecycle helpers for MAIN readers and missing relays. */
(function (root) {
  'use strict';

  const RECEIVER_MISSING = /could not establish connection|receiving end does not exist|message (?:channel|port) closed before a response was received/i;
  const mainBridgeMissing = response => Boolean(
    response && response.ready === false && response.reason === 'outdated_tab' &&
    String(response.message || '').includes('puente interno no respondió')
  );

  const reactivateMain = (windowRef, markerKey) => {
    const previous = windowRef && windowRef[markerKey];
    if (!previous) return false;
    if (typeof previous.reactivate === 'function') previous.reactivate();
    // Legacy boolean markers have no listener closure. Keep them fail-closed until reload.
    return true;
  };

  const installMain = (windowRef, markerKey, listener) => {
    const reactivate = () => {
      windowRef.removeEventListener('message', listener);
      windowRef.addEventListener('message', listener);
    };
    reactivate();
    windowRef[markerKey] = Object.freeze({ reactivate });
  };

  const createHealthProbe = ({
    sendMessage, withTimeout, timeoutMs, recoverMissingReceiver,
    timeoutMessage,
  }) => async (tabId, message) => {
    const send = () => withTimeout(sendMessage(tabId, message), timeoutMs, timeoutMessage);
    try {
      const response = await send();
      if ((response != null && !mainBridgeMissing(response)) || !recoverMissingReceiver) return response;
      const recovered = await recoverMissingReceiver(tabId);
      return recovered?.injected === true ? send() : response;
    } catch (error) {
      const detail = String((error && error.message) || error || '');
      if (!recoverMissingReceiver || !RECEIVER_MISSING.test(detail)) throw error;
      const recovered = await recoverMissingReceiver(tabId);
      if (!recovered || recovered.injected !== true) throw error;
      return send();
    }
  };

  const repairHealth = (readHealth, recover) => async (...args) => {
    const response = await readHealth(...args);
    if (!mainBridgeMissing(response)) return response;
    const recovered = await recover();
    return recovered?.injected === true || recovered?.injectedTabs > 0
      ? readHealth(...args)
      : response;
  };

  root.HhrConnectionRelayRecovery = Object.freeze({
    createHealthProbe,
    installMain,
    reactivateMain,
    repairHealth,
  });
})(typeof self !== 'undefined' ? self : globalThis);
