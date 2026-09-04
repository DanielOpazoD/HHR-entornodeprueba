/**
 * Version + lifecycle-generation handshake for ISOLATED relays and shared tests.
 * Chrome MAIN entries load bridge-generation-main.js as a distinct resource.
 */
(function (root) {
  'use strict';

  const MAIN_WORLD_GENERATION_KEY = '__hhrExtensionRuntimeGenerationV1__';

  const createMain = ({ version, windowRef = root.window }) => {
    const contextFor = request => {
      const requestedRuntimeGeneration = String(request && request.runtimeGeneration || '');
      const bridgeGeneration = String(windowRef[MAIN_WORLD_GENERATION_KEY] || '');
      return {
        bridgeGeneration,
        current: Boolean(requestedRuntimeGeneration && bridgeGeneration === requestedRuntimeGeneration),
      };
    };

    const metadata = context => ({
      injectVersion: version,
      bridgeGeneration: context ? context.bridgeGeneration : String(windowRef[MAIN_WORLD_GENERATION_KEY] || ''),
    });

    const accept = (request, resultType, rejection) => {
      const context = contextFor(request);
      if (context.current) return context;
      windowRef.postMessage({
        type: resultType,
        reqId: request && request.reqId,
        ...metadata(context),
        ...rejection,
      }, windowRef.location.origin);
      return null;
    };

    return Object.freeze({ accept, contextFor, metadata, post: (payload, context) => windowRef.postMessage({ ...payload, ...metadata(context) }, windowRef.location.origin) });
  };

  const createRelay = ({ chromeApi, runtimeMessages, extensionVersion }) => {
    const context = new Promise(resolve => {
      try {
        chromeApi.runtime.sendMessage(
          { type: runtimeMessages.EXTENSION_RUNTIME_CONTEXT_REQUEST },
          response => {
            const error = chromeApi.runtime.lastError;
            resolve(!error && response && typeof response.runtimeGeneration === 'string'
              ? response
              : null);
          }
        );
      } catch (_error) {
        resolve(null);
      }
    });
    const isCurrent = (data, runtimeGeneration) => Boolean(
      data &&
      data.injectVersion === extensionVersion &&
      data.bridgeGeneration === runtimeGeneration
    );
    return Object.freeze({ context, isCurrent });
  };

  root.HhrBridgeGeneration = Object.freeze({
    createMain,
    createRelay,
  });
})(typeof self !== 'undefined' ? self : globalThis);
