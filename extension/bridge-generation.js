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

  const requestContext = ({ chromeApi, runtimeMessages }) => new Promise(resolve => {
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

  // A relay starts at document_start; if the service worker is asleep at that instant the first
  // request fails and, without a retry, the tab stayed "desconectada" until a reload.
  const createRelay = ({
    chromeApi,
    runtimeMessages,
    extensionVersion,
    maxAttempts = 3,
    retryDelayMs = 250,
    delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  }) => {
    const context = (async () => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await requestContext({ chromeApi, runtimeMessages });
        if (response) return response;
        if (attempt < maxAttempts) await delay(retryDelayMs * attempt);
      }
      return null;
    })();
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
