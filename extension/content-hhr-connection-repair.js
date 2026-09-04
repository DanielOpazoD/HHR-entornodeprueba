/** Page/runtime bridge for the clean Eloísa connection repair action. */
(() => {
  'use strict';
  if (globalThis.__hhrConnectionRepairBridgeInstalled) return;
  const runtimeMessages = globalThis.HhrRayenMessageContract?.types;
  if (!runtimeMessages) return;
  globalThis.__hhrConnectionRepairBridgeInstalled = true;
  const MIN_REPAIR_INTERVAL_MS = 2_000;
  let repairInFlight = false;
  let lastRepairAt = 0;

  const postResult = (reqId, payload) => {
    window.postMessage(
      { type: 'HHR_RAYEN_CONNECTION_REPAIR_RESULT', reqId, ...payload },
      window.location.origin
    );
  };

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== 'HHR_RAYEN_CONNECTION_REPAIR_REQUEST') return;
    const reqId = data.reqId;
    if (typeof reqId !== 'string' || reqId.length > 160) return;
    const now = Date.now();
    if (globalThis.navigator?.userActivation?.isActive !== true) {
      postResult(reqId, { ok: false, error: 'La reparación requiere una acción del usuario.' });
      return;
    }
    if (repairInFlight || now - lastRepairAt < MIN_REPAIR_INTERVAL_MS) {
      postResult(reqId, { ok: false, error: 'Ya hay una reparación en curso.' });
      return;
    }
    repairInFlight = true;
    lastRepairAt = now;
    Promise.resolve()
      .then(() => chrome.runtime.sendMessage({ type: runtimeMessages.CONNECTION_REPAIR_REQUEST }))
      .then(response => {
        postResult(reqId, {
          ok: Boolean(response?.ok),
          state: response?.state,
          message: response?.message,
          error: response?.error,
          requiresLogin: response?.requiresLogin === true,
          report: response?.report,
        });
      })
      .catch(error => {
        console.warn('[Rayen→HHR] Connection repair error:', error);
        postResult(reqId, { ok: false, error: String(error) });
      })
      .finally(() => {
        repairInFlight = false;
      });
  });
})();
