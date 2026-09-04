/** MAIN-world handshake used to verify that Gestión de Camas belongs to this extension lifecycle. */
(function (root) {
  'use strict';

  const create = ({
    windowRef = root.window,
    runtimeContextPromise,
    isCurrentBridgeMessage,
    timeoutMs = 4000,
  }) => {
    const read = async () => {
      const runtimeContext = await runtimeContextPromise;
      const runtimeGeneration = runtimeContext && runtimeContext.runtimeGeneration;
      if (!runtimeGeneration) {
        return {
          ready: false,
          reason: 'relay_disconnected',
          message: 'El relé de Gestión de Camas perdió conexión con la extensión.',
        };
      }
      return new Promise(resolve => {
        const reqId = 'gc-health-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
        let settled = false;
        const cleanup = () => {
          if (settled) return;
          settled = true;
          windowRef.removeEventListener('message', onMessage);
        };
        const onMessage = event => {
          if (event.source !== windowRef) return;
          const data = event.data;
          if (!data || data.type !== 'RAYEN_GC_BRIDGE_STATUS_RESULT' || data.reqId !== reqId) return;
          cleanup();
          const current = isCurrentBridgeMessage(data, runtimeGeneration);
          resolve({
            ready: current,
            reason: current ? 'connected' : 'outdated_tab',
            bridgeVersion: data.injectVersion,
            bridgeGeneration: data.bridgeGeneration,
            message: current
              ? 'Gestión de Camas disponible.'
              : 'Abre una pestaña nueva de Gestión de Camas: la pestaña actual está desactualizada.',
          });
        };
        windowRef.addEventListener('message', onMessage);
        windowRef.postMessage({
          type: 'RAYEN_GC_BRIDGE_STATUS_REQUEST',
          reqId,
          runtimeGeneration,
        }, windowRef.location.origin);
        setTimeout(() => {
          if (settled) return;
          cleanup();
          resolve({
            ready: false,
            reason: 'outdated_tab',
            message: 'Abre una pestaña nueva de Gestión de Camas: el puente interno no respondió.',
          });
        }, timeoutMs);
      });
    };

    return Object.freeze({ read });
  };

  root.HhrGestionCamasBridgeHealth = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
