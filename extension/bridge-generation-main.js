/** Lifecycle-generation handshake for scripts injected in the page MAIN world. */
(function (root) {
  'use strict';

  const MAIN_WORLD_GENERATION_KEY = '__hhrExtensionRuntimeGenerationV1__';

  const createMain = ({ version, windowRef = root.window }) => {
    const contextFor = request => {
      const requestedRuntimeGeneration = String(request && request.runtimeGeneration || '');
      const bridgeGeneration = String(windowRef[MAIN_WORLD_GENERATION_KEY] || '');
      return {
        bridgeGeneration,
        current: Boolean(
          requestedRuntimeGeneration && bridgeGeneration === requestedRuntimeGeneration
        ),
      };
    };

    const metadata = context => ({
      injectVersion: version,
      bridgeGeneration: context
        ? context.bridgeGeneration
        : String(windowRef[MAIN_WORLD_GENERATION_KEY] || ''),
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

    return Object.freeze({
      accept,
      contextFor,
      metadata,
      post: (payload, context) => windowRef.postMessage(
        { ...payload, ...metadata(context) },
        windowRef.location.origin
      ),
    });
  };

  root.HhrBridgeGeneration = Object.freeze({ createMain });
})(typeof self !== 'undefined' ? self : globalThis);
