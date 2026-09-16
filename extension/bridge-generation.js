/** Recoverable ISOLATED handshake; MAIN uses bridge-generation-main.js. */
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
        ...metadata(context), ...rejection,
      }, windowRef.location.origin);
      return null;
    };
    return Object.freeze({ accept, contextFor, metadata, post: (payload, context) => windowRef.postMessage({ ...payload, ...metadata(context) }, windowRef.location.origin) });
  };
  const requestContext = ({ chromeApi, runtimeMessages, timeoutMs }) => new Promise(resolve => {
    const finish = value => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      chromeApi.runtime.sendMessage(
        { type: runtimeMessages.EXTENSION_RUNTIME_CONTEXT_REQUEST },
        response => {
          const error = chromeApi.runtime.lastError;
          finish(!error && response && typeof response.runtimeGeneration === 'string'
            ? response : null);
        }
      );
    } catch (_error) {
      finish(null);
    }
  });
  const createRelay = ({
    chromeApi, runtimeMessages, extensionVersion,
    maxAttempts = 3,
    retryDelayMs = 250,
    requestTimeoutMs = 1000,
    recoveryDelayMs = 1000,
    now = () => Date.now(),
    delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  }) => {
    let cached = null;
    let inFlight = null;
    let retryAt = 0;
    const getContext = () => {
      if (cached) return Promise.resolve(cached);
      if (inFlight) return inFlight;
      if (now() < retryAt) return Promise.resolve(null);
      inFlight = (async () => {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const response = await requestContext({ chromeApi, runtimeMessages, timeoutMs: requestTimeoutMs });
          if (response) { cached = response; return response; }
          if (attempt < maxAttempts) await delay(retryDelayMs * attempt);
        }
        retryAt = now() + recoveryDelayMs;
        return null;
      })().finally(() => { inFlight = null; });
      return inFlight;
    };
    // Prime once; a failed startup may recover on the next heartbeat/request.
    const context = getContext();
    const isCurrent = (data, runtimeGeneration) => Boolean(
      data &&
      data.injectVersion === extensionVersion &&
      data.bridgeGeneration === runtimeGeneration
    );
    return Object.freeze({ context, getContext, isCurrent });
  };
  root.HhrBridgeGeneration = Object.freeze({ createMain, createRelay });
})(typeof self !== 'undefined' ? self : globalThis);
