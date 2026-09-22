/** Recoverable ISOLATED handshake; MAIN uses bridge-generation-main.js. */
(function (root) {
  'use strict';
  const BRIDGE_PROTOCOL_VERSION = 1;
  // Direct upgrade path to the first protocol-bearing release. Remove once no
  // supported installation can still have one of these MAIN readers open.
  const LEGACY_COMPATIBLE_VERSIONS = Object.freeze(['0.48.25', '0.48.26']);
  const requestContext = ({ chromeApi, runtimeMessages, timeoutMs }) => new Promise(resolve => {
    const finish = value => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      const runtime = chromeApi && chromeApi.runtime;
      if (!runtime || typeof runtime.sendMessage !== 'function') return finish(null);
      runtime.sendMessage(
        { type: runtimeMessages.EXTENSION_RUNTIME_CONTEXT_REQUEST },
        response => {
          let error;
          try { error = runtime.lastError; }
          catch (_error) { return finish(null); }
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
    bridgeProtocolVersion = BRIDGE_PROTOCOL_VERSION,
    compatibleLegacyVersions = LEGACY_COMPATIBLE_VERSIONS,
    maxAttempts = 3,
    retryDelayMs = 250,
    requestTimeoutMs = 1000,
    recoveryDelayMs = 1000,
    onContext = () => undefined,
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
          if (response) { cached = response;
            Promise.resolve().then(() => onContext(response)).catch(() => undefined); return response; }
          if (attempt < maxAttempts) await delay(retryDelayMs * attempt);
        }
        retryAt = now() + recoveryDelayMs;
        return null;
      })().finally(() => { inFlight = null; });
      return inFlight;
    };
    // Prime once; a failed startup may recover on the next heartbeat/request.
    const context = getContext();
    const isCompatibleBridge = data => Boolean(
      data && (
        data.bridgeProtocolVersion === bridgeProtocolVersion ||
        (
          data.bridgeProtocolVersion == null &&
          (
            data.injectVersion === extensionVersion ||
            compatibleLegacyVersions.includes(String(data.injectVersion || ''))
          )
        )
      )
    );
    const isCurrent = (data, runtimeGeneration) => Boolean(
      isCompatibleBridge(data) && data.bridgeGeneration === runtimeGeneration
    );
    return Object.freeze({ context, getContext, isCurrent });
  };
  root.HhrBridgeGeneration = Object.freeze({
    BRIDGE_PROTOCOL_VERSION,
    LEGACY_COMPATIBLE_VERSIONS,
    createRelay,
  });
})(typeof self !== 'undefined' ? self : globalThis);
