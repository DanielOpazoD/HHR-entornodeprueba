/** Owns only the shared offscreen document; request data is never retained in diagnostics. */
(function (root) {
  'use strict';

  function create(dependencies = {}) {
    const chrome = dependencies.chrome || root.chrome;
    const contract = root.HhrOffscreenContract;
    const setTimer = dependencies.setTimeout || root.setTimeout.bind(root);
    const clearTimer = dependencies.clearTimeout || root.clearTimeout.bind(root);
    const uuid = dependencies.randomUUID || (() => root.crypto.randomUUID());
    const now = dependencies.now || Date.now;
    const pending = new Map();
    const counters = { completed: 0, failed: 0, cancelled: 0, timedOut: 0 };
    let generation = 0;
    let document = null;
    let ensuring = null;
    let closing = null;
    let lifecycle = Promise.resolve();
    const error = (code, message = code) => Object.assign(new Error(message), { code });
    const envelope = (action, requestId, extra = {}) => ({
      target: contract.target, version: contract.version, action, requestId, ...extra,
    });
    const serial = task => {
      const operation = lifecycle.then(task);
      lifecycle = operation.catch(() => {});
      return operation;
    };
    const send = message => Promise.resolve().then(() => chrome.runtime.sendMessage(message));
    function cancel(entry) {
      if (entry.dispatched) {
        void send(envelope('cancel', entry.id, { documentId: entry.documentId })).catch(() => {});
      }
    }
    function invalidate() {
      generation += 1;
      document = null;
      for (const entry of pending.values()) {
        if (entry.dispatched) entry.finish(error('OFFSCREEN_STALE_GENERATION'), undefined, true);
      }
    }
    async function discover() {
      if (typeof chrome?.runtime?.getContexts !== 'function') {
        throw error('OFFSCREEN_UNSUPPORTED', 'Chrome 118 or newer is required');
      }
      let contexts;
      try {
        contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      } catch {
        throw error('OFFSCREEN_DISCOVERY_FAILED');
      }
      if (!Array.isArray(contexts)) throw error('OFFSCREEN_DISCOVERY_FAILED');
      const url = chrome.runtime.getURL(contract.documentPath);
      if (contexts.length > 1 || contexts.some(context => context.documentUrl !== url)) {
        throw error('OFFSCREEN_FOREIGN_DOCUMENT');
      }
      return contexts[0] || null;
    }
    function valid(response, requestId, documentId) {
      return response?.version === contract.version && response.requestId === requestId &&
        typeof response.documentId === 'string' && response.documentId.length > 0 &&
        (documentId === undefined || response.documentId === documentId);
    }
    async function probe() {
      const id = uuid();
      let timer;
      try {
        const response = await Promise.race([
          send(envelope('probe', id)),
          new Promise((_, reject) => {
            timer = setTimer(() => reject(error('OFFSCREEN_HANDSHAKE_TIMEOUT')), contract.handshakeTimeoutMs);
          }),
        ]);
        if (!valid(response, id) || response.ok !== true || response.result?.ready !== true) {
          throw error('OFFSCREEN_INVALID_HANDSHAKE');
        }
        return response.documentId;
      } catch (cause) {
        throw error(cause?.code === 'OFFSCREEN_HANDSHAKE_TIMEOUT'
          ? 'OFFSCREEN_HANDSHAKE_TIMEOUT' : 'OFFSCREEN_INVALID_HANDSHAKE');
      } finally {
        clearTimer(timer);
      }
    }
    function ensure() {
      if (closing) return Promise.reject(error('OFFSCREEN_CLOSING'));
      if (ensuring) return ensuring;
      let startedGeneration = generation;
      const check = () => {
        if (generation !== startedGeneration || closing) throw error('OFFSCREEN_STALE_GENERATION');
      };
      const operation = serial(async () => {
        check();
        let context = await discover();
        check();
        // Invalidate as soon as discovery observes replacement, not after its handshake.
        if (document && (!context || document.contextId !== context.contextId)) {
          invalidate();
          startedGeneration = generation;
        }
        if (!context) {
          if (typeof chrome?.offscreen?.createDocument !== 'function') throw error('OFFSCREEN_UNSUPPORTED');
          try {
            await chrome.offscreen.createDocument({
              url: contract.documentPath, reasons: ['IFRAME_SCRIPTING'],
              justification: 'Shared isolated document for clinical import processing',
            });
          } catch {
            throw error('OFFSCREEN_CREATE_FAILED');
          }
          check();
          context = await discover();
          check();
          if (!context) throw error('OFFSCREEN_DOCUMENT_MISSING');
        }
        const documentId = await probe();
        check();
        if (document && (document.documentId !== documentId || document.contextId !== context.contextId)) {
          invalidate();
        }
        document = { documentId, contextId: context.contextId, generation };
        return { ...document };
      });
      ensuring = operation.catch(cause => {
        if (document) invalidate();
        throw cause;
      }).finally(() => { ensuring = null; });
      return ensuring;
    }
    function request(channel, payload, { timeoutMs = 30_000, signal } = {}) {
      if (closing) return Promise.reject(error('OFFSCREEN_CLOSING'));
      if (pending.size >= contract.maxPending) return Promise.reject(error('OFFSCREEN_BUSY'));
      if (signal?.aborted) return Promise.reject(error('OFFSCREEN_ABORTED'));
      if (typeof channel !== 'string' || !channel || !Number.isFinite(timeoutMs)) {
        return Promise.reject(error('OFFSCREEN_INVALID_REQUEST'));
      }
      timeoutMs = Math.min(contract.maxTimeoutMs, Math.max(contract.minTimeoutMs, timeoutMs));
      const deadline = now() + timeoutMs;
      const id = uuid();
      return new Promise((resolve, reject) => {
        let timer;
        const aborted = () => entry.finish(error('OFFSCREEN_ABORTED'), undefined, true);
        const entry = { id, dispatched: false, documentId: null, generation: null, finish };
        function finish(cause, result, shouldCancel = false) {
          if (!pending.delete(id)) return;
          clearTimer(timer);
          signal?.removeEventListener('abort', aborted);
          if (shouldCancel) cancel(entry);
          if (cause) {
            counters.failed += 1;
            if (cause.code === 'OFFSCREEN_ABORTED') counters.cancelled += 1;
            if (cause.code === 'OFFSCREEN_TIMEOUT') counters.timedOut += 1;
            reject(cause);
          } else {
            counters.completed += 1;
            resolve(result);
          }
        }
        pending.set(id, entry); // Admission precedes ensure, including its asynchronous creation.
        timer = setTimer(() => finish(error('OFFSCREEN_TIMEOUT'), undefined, true), timeoutMs);
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) { aborted(); return; }
        void ensure().then(async ready => {
          if (!pending.has(id)) return;
          if (closing || ready.generation !== generation) throw error('OFFSCREEN_STALE_GENERATION');
          const remaining = Math.ceil(deadline - now());
          if (remaining <= 0) { finish(error('OFFSCREEN_TIMEOUT'), undefined, true); return; }
          entry.documentId = ready.documentId;
          entry.generation = ready.generation;
          entry.dispatched = true;
          // Once dispatched, any transport failure is ambiguous: never replay the work.
          let response;
          try {
            response = await chrome.runtime.sendMessage(envelope('request', id, {
              documentId: entry.documentId, channel, payload,
              timeoutMs: Math.max(contract.minTimeoutMs, remaining),
            }));
          } catch {
            throw error('OFFSCREEN_TRANSPORT_FAILED');
          }
          if (!pending.has(id)) return;
          if (entry.generation !== generation) throw error('OFFSCREEN_STALE_GENERATION');
          if (!valid(response, id, entry.documentId)) throw error('OFFSCREEN_INVALID_RESPONSE');
          if (response.ok === false && typeof response.error?.code === 'string' &&
            typeof response.error.message === 'string') {
            throw error(response.error.code, response.error.message);
          }
          if (response.ok !== true) throw error('OFFSCREEN_INVALID_RESPONSE');
          finish(null, response.result);
        }).catch(cause => finish(cause, undefined, true));
      });
    }
    function close({ force = false } = {}) {
      if (closing) return closing;
      if (pending.size && !force) return Promise.reject(error('OFFSCREEN_ACTIVE_REQUESTS'));
      if (force) {
        for (const entry of pending.values()) entry.finish(error('OFFSCREEN_CLOSED'), undefined, true);
      }
      invalidate();
      const operation = serial(async () => {
        const context = await discover();
        if (!context) return;
        if (typeof chrome?.offscreen?.closeDocument !== 'function') throw error('OFFSCREEN_UNSUPPORTED');
        try { await chrome.offscreen.closeDocument(); }
        catch { throw error('OFFSCREEN_CLOSE_FAILED'); }
      });
      closing = operation.finally(() => { closing = null; });
      return closing;
    }
    return Object.freeze({
      request, ensure, close,
      getDiagnostics: () => ({
        ...counters, pending: pending.size, generation,
        ready: document !== null, ensuring: ensuring !== null, closing: closing !== null,
      }),
    });
  }

  root.HhrOffscreenCoordinator = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
