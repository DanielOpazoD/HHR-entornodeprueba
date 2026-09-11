/** Private offscreen endpoint. Only the extension service worker may dispatch work. */
(function (root) {
  'use strict';

  const RECENT_LIMIT = 256;
  const validId = value =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

  const create = (deps = {}) => {
    const contract = root.HhrOffscreenContract;
    const runtime = deps.chrome?.runtime;
    const cryptoApi = deps.crypto || root.crypto;
    if (!contract || !runtime?.id || !runtime.onMessage || !cryptoApi?.randomUUID) {
      throw new Error('Offscreen router dependencies unavailable.');
    }
    const documentId = cryptoApi.randomUUID();
    const workerUrl = runtime.getURL('background.js');
    const handlers = new Map(Object.entries(deps.handlers || {}));
    const now = deps.now || Date.now;
    const schedule = deps.setTimeout || root.setTimeout.bind(root);
    const unschedule = deps.clearTimeout || root.clearTimeout.bind(root);
    const Controller = deps.AbortController || root.AbortController;
    const active = new Map();
    const recent = new Map();
    let disposed = false;

    const pruneRecent = () => {
      const time = now();
      for (const [id, expires] of recent) {
        if (expires <= time) recent.delete(id);
      }
    };
    const remember = id => {
      pruneRecent();
      recent.set(id, now() + contract.maxTimeoutMs);
      while (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value);
    };
    const reply = (sendResponse, requestId, body) => {
      try {
        sendResponse({
          version: contract.version,
          requestId: validId(requestId) ? requestId : null,
          documentId,
          ...body,
        });
      } catch {
        // The worker may already have closed its response port. Never log clinical data.
      }
    };
    const failure = (code, message) => ({ ok: false, error: { code, message } });
    const settle = (entry, body, abort = false) => {
      if (entry.settled) return;
      entry.settled = true;
      active.delete(entry.requestId);
      unschedule(entry.timer);
      if (!disposed) remember(entry.requestId);
      const sendResponse = entry.sendResponse;
      entry.sendResponse = null;
      const controller = entry.controller;
      entry.controller = null;
      // Remove ownership before abort listeners or sendResponse can reenter the router.
      if (abort) controller.abort();
      reply(sendResponse, entry.requestId, body);
    };

    const isAuthorized = (message, sender) => {
      if (disposed || !message || message.target !== contract.target) return false;
      if (sender?.id !== runtime.id || sender.tab) return false;
      return sender.url === undefined || sender.url === workerUrl;
    };

    const validateEnvelope = message => {
      if (!validId(message.requestId))
        return failure('INVALID_REQUEST', 'Invalid request identifier.');
      if (message.version !== contract.version)
        return failure('VERSION_MISMATCH', 'Unsupported protocol version.');
      if (message.action === 'probe') return null;
      if (message.action !== 'request' && message.action !== 'cancel')
        return failure('INVALID_REQUEST', 'Unsupported action.');
      if (!validId(message.documentId))
        return failure('INVALID_REQUEST', 'Invalid document identifier.');
      if (message.documentId !== documentId)
        return failure('STALE_DOCUMENT', 'Offscreen document changed.');
      return null;
    };

    const validateAdmission = message => {
      if (typeof handlers.get(message.channel) !== 'function')
        return failure('UNKNOWN_CHANNEL', 'Unsupported channel.');
      if (
        message.timeoutMs !== undefined &&
        (typeof message.timeoutMs !== 'number' || !Number.isFinite(message.timeoutMs))
      )
        return failure('INVALID_REQUEST', 'Invalid timeout.');
      pruneRecent();
      if (active.has(message.requestId) || recent.has(message.requestId))
        return failure('DUPLICATE_REQUEST', 'Request identifier already used.');
      if (active.size >= contract.maxPending)
        return failure('CAPACITY_EXCEEDED', 'Too many active requests.');
      return null;
    };

    const startRequest = (message, sendResponse) => {
      const handler = handlers.get(message.channel);
      const timeout = Math.min(
        contract.maxTimeoutMs,
        Math.max(contract.minTimeoutMs, message.timeoutMs ?? contract.maxTimeoutMs)
      );
      const controller = new Controller();
      const entry = {
        requestId: message.requestId,
        controller,
        sendResponse,
        settled: false,
        timer: null,
      };
      active.set(entry.requestId, entry);
      entry.timer = schedule(
        () => settle(entry, failure('TIMEOUT', 'Request timed out.'), true),
        timeout
      );
      Promise.resolve()
        .then(() => {
          if (entry.settled) return undefined;
          return handler(message.payload, {
            signal: controller.signal,
            requestId: entry.requestId,
            timeoutMs: timeout,
          });
        })
        .then(
          result => settle(entry, { ok: true, result }),
          () => settle(entry, failure('HANDLER_ERROR', 'Offscreen handler failed.'))
        );
      return true;
    };

    const dispatch = (message, sendResponse) => {
      if (message.action === 'probe') {
        reply(sendResponse, message.requestId, { ok: true, result: { ready: true } });
        return false;
      }
      if (message.action === 'cancel') {
        const entry = active.get(message.requestId);
        if (entry) settle(entry, failure('CANCELLED', 'Request cancelled.'), true);
        reply(sendResponse, message.requestId, { ok: true, result: { cancelled: Boolean(entry) } });
        return false;
      }
      const error = validateAdmission(message);
      if (error) {
        reply(sendResponse, message.requestId, error);
        return false;
      }
      return startRequest(message, sendResponse);
    };

    const listener = (message, sender, sendResponse) => {
      if (!isAuthorized(message, sender)) return false;
      const error = validateEnvelope(message);
      if (error) {
        reply(sendResponse, message.requestId, error);
        return false;
      }
      return dispatch(message, sendResponse);
    };

    runtime.onMessage.addListener(listener);
    return Object.freeze({
      documentId,
      getDiagnostics() {
        pruneRecent();
        return {
          inflight: active.size,
          recentCompleted: recent.size,
          maxPending: contract.maxPending,
          disposed,
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        runtime.onMessage.removeListener(listener);
        for (const entry of active.values())
          settle(entry, failure('DISPOSED', 'Offscreen router disposed.'), true);
        active.clear();
        recent.clear();
        handlers.clear();
      },
    });
  };

  root.HhrOffscreenRouter = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
