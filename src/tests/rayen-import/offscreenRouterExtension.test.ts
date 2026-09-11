// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../extension/offscreen-contract.js';
import '../../../extension/offscreen-router.js';

type Response = {
  version: number;
  requestId: string | null;
  documentId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};
type Sender = { id?: string; tab?: unknown; url?: unknown };
type Listener = (
  message: Record<string, unknown>,
  sender: Sender,
  respond: (response: Response) => void
) => boolean;
type Handler = (
  payload: unknown,
  context: { signal: AbortSignal; requestId: string; timeoutMs: number }
) => unknown;
type Router = {
  documentId: string;
  dispose: () => void;
  getDiagnostics: () => {
    inflight: number;
    recentCompleted: number;
    maxPending: number;
    disposed: boolean;
  };
};
const owner = (
  globalThis as typeof globalThis & {
    HhrOffscreenRouter: { create: (deps: Record<string, unknown>) => Router };
  }
).HhrOffscreenRouter;
const disposables: Router[] = [];
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};
const harness = (
  handler: Handler = async payload => payload,
  handlers?: Record<string, Handler>
) => {
  const listeners = new Set<Listener>();
  const chrome = {
    runtime: {
      id: 'extension-id',
      getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      onMessage: {
        addListener: vi.fn((listener: Listener) => listeners.add(listener)),
        removeListener: vi.fn((listener: Listener) => listeners.delete(listener)),
      },
      sendMessage: vi.fn(),
    },
    storage: { local: { set: vi.fn() } },
  };
  const router = owner.create({ chrome, handlers: handlers || { syslab: handler } });
  disposables.push(router);
  const listener = [...listeners][0];
  const send = (
    patch: Record<string, unknown> = {},
    sender: Sender = { id: chrome.runtime.id }
  ) => {
    const respond = vi.fn<(response: Response) => void>();
    const message = {
      target: 'hhr-shared-offscreen',
      version: 1,
      action: 'request',
      requestId: 'request-1',
      documentId: router.documentId,
      channel: 'syslab',
      payload: { secret: 'clinical-payload' },
      timeoutMs: 1000,
      ...patch,
    };
    const retained = listener(message, sender, respond);
    return { respond, retained };
  };
  return { router, chrome, listeners, send };
};
const errorCode = (result: ReturnType<ReturnType<typeof harness>['send']>) =>
  result.respond.mock.calls[0]?.[0].error?.code;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  disposables.splice(0).forEach(router => router.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('private offscreen router', () => {
  it('probes a unique UUID document with exact correlation and accepts real worker sender variants', () => {
    const first = harness();
    const second = harness();
    expect(first.router.documentId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
    );
    expect(second.router.documentId).not.toBe(first.router.documentId);
    for (const sender of [
      { id: 'extension-id' },
      { id: 'extension-id', url: first.chrome.runtime.getURL('background.js') },
    ]) {
      const result = first.send({ action: 'probe', documentId: undefined }, sender);
      expect(result.retained).toBe(false);
      expect(result.respond).toHaveBeenCalledExactlyOnceWith({
        version: 1,
        requestId: 'request-1',
        documentId: first.router.documentId,
        ok: true,
        result: { ready: true },
      });
    }
  });

  it('runs same-channel requests concurrently and correlates reverse completion', async () => {
    const jobs = [deferred(), deferred(), deferred()];
    const handler = vi.fn((_payload, { requestId }) => jobs[Number(requestId)].promise);
    const { send, router } = harness(handler);
    const calls = jobs.map((_, index) => send({ requestId: String(index) }));
    expect(calls.every(call => call.retained)).toBe(true);
    await flush();
    expect(handler).toHaveBeenCalledTimes(3);
    expect(router.getDiagnostics().inflight).toBe(3);
    for (const index of [2, 1, 0]) {
      jobs[index].resolve(`result-${index}`);
      await flush();
      expect(calls[index].respond).toHaveBeenCalledExactlyOnceWith({
        version: 1,
        requestId: String(index),
        documentId: router.documentId,
        ok: true,
        result: `result-${index}`,
      });
    }
    expect(router.getDiagnostics().inflight).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {},
    { id: 'other-extension' },
    { id: 'extension-id', tab: {} },
    { id: 'extension-id', tab: { id: 4 }, url: 'https://example.org' },
    { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' },
    { id: 'extension-id', url: 'chrome-extension://extension-id/syslab-offscreen.html' },
    { id: 'extension-id', url: 'chrome-extension://extension-id/background.js?spoof=1' },
    { id: 'extension-id', url: null },
  ])('ignores unauthorized sender %j without revealing document identity', async sender => {
    const handler = vi.fn();
    const { send } = harness(handler);
    const call = send({}, sender);
    await flush();
    expect(call.retained).toBe(false);
    expect(call.respond).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    [{ version: 2 }, 'VERSION_MISMATCH'],
    [{ version: '1' }, 'VERSION_MISMATCH'],
    [{ documentId: 'stale-document' }, 'STALE_DOCUMENT'],
    [{ documentId: {} }, 'INVALID_REQUEST'],
    [{ requestId: '' }, 'INVALID_REQUEST'],
    [{ requestId: 'x'.repeat(129) }, 'INVALID_REQUEST'],
    [{ requestId: { secret: 'clinical' } }, 'INVALID_REQUEST'],
    [{ requestId: 'bad id' }, 'INVALID_REQUEST'],
    [{ channel: 'diagnostics' }, 'UNKNOWN_CHANNEL'],
    [{ channel: '__proto__' }, 'UNKNOWN_CHANNEL'],
    [{ channel: 'toString' }, 'UNKNOWN_CHANNEL'],
    [{ action: 'diagnostics' }, 'INVALID_REQUEST'],
    [{ timeoutMs: NaN }, 'INVALID_REQUEST'],
    [{ timeoutMs: Infinity }, 'INVALID_REQUEST'],
    [{ timeoutMs: '250' }, 'INVALID_REQUEST'],
  ])('rejects invalid envelope %j with current document correlation', async (patch, code) => {
    const handler = vi.fn();
    const { send, router } = harness(handler);
    const call = send(patch);
    await flush();
    expect(errorCode(call)).toBe(code);
    expect(call.respond).toHaveBeenCalledTimes(1);
    expect(call.respond.mock.calls[0][0]).toMatchObject({
      version: 1,
      documentId: router.documentId,
      ok: false,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores unrelated targets and accepts only own registered channels', async () => {
    const inherited = vi.fn();
    const handler = vi.fn(async () => 4);
    const handlers = Object.assign(Object.create({ inherited }), {
      syslab: handler,
      report: handler,
    });
    const { send } = harness(handler, handlers);
    expect(send({ target: 'another-runtime' }).respond).not.toHaveBeenCalled();
    expect(errorCode(send({ channel: 'inherited' }))).toBe('UNKNOWN_CHANNEL');
    const accepted = send({ channel: 'report' });
    await flush();
    expect(accepted.respond.mock.calls[0][0].result).toBe(4);
    expect(inherited).not.toHaveBeenCalled();
  });

  it('rejects active and recent duplicates without touching the original response', async () => {
    const job = deferred();
    const handler = vi.fn(() => job.promise);
    const { send } = harness(handler);
    const original = send();
    expect(errorCode(send())).toBe('DUPLICATE_REQUEST');
    await flush();
    expect(original.respond).not.toHaveBeenCalled();
    job.resolve('done');
    await flush();
    expect(errorCode(send())).toBe('DUPLICATE_REQUEST');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(original.respond).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1, 250],
    [999_999, 601_000],
    [undefined, 601_000],
  ])('bounds timeout %s at %s and ignores late resolution', async (timeoutMs, duration) => {
    const job = deferred();
    let signal!: AbortSignal;
    const { send, router } = harness((_payload, context) => {
      signal = context.signal;
      expect(context.timeoutMs).toBe(duration);
      return job.promise;
    });
    const call = send({ timeoutMs });
    await flush();
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(call.respond).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(errorCode(call)).toBe('TIMEOUT');
    expect(signal.aborted).toBe(true);
    expect(router.getDiagnostics().inflight).toBe(0);
    job.resolve('late');
    await flush();
    expect(call.respond).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('validates cancel authority, aborts once and ignores late rejection', async () => {
    const job = deferred();
    let signal!: AbortSignal;
    const { send, router } = harness((_payload, context) => {
      signal = context.signal;
      return job.promise;
    });
    const original = send();
    await flush();
    expect(errorCode(send({ action: 'cancel', documentId: 'stale' }))).toBe('STALE_DOCUMENT');
    expect(errorCode(send({ action: 'cancel', version: 2 }))).toBe('VERSION_MISMATCH');
    send({ action: 'cancel' }, { id: 'extension-id', tab: {} });
    expect(signal.aborted).toBe(false);
    const cancel = send({ action: 'cancel' });
    expect(cancel.respond.mock.calls[0][0].result).toEqual({ cancelled: true });
    expect(errorCode(original)).toBe('CANCELLED');
    expect(signal.aborted).toBe(true);
    expect(router.getDiagnostics().inflight).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(send({ action: 'cancel' }).respond.mock.calls[0][0].result).toEqual({
      cancelled: false,
    });
    expect(errorCode(send())).toBe('DUPLICATE_REQUEST');
    job.reject(new Error('late private failure'));
    await flush();
    expect(original.respond).toHaveBeenCalledTimes(1);
  });

  it('disposes all pending work, clears memory, removes listener and ignores late results', async () => {
    const jobs = [deferred(), deferred()];
    const signals: AbortSignal[] = [];
    const { send, router, listeners, chrome } = harness((_payload, context) => {
      signals.push(context.signal);
      return jobs[Number(context.requestId)].promise;
    });
    const calls = jobs.map((_, index) => send({ requestId: String(index) }));
    await flush();
    router.dispose();
    router.dispose();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(calls.map(errorCode)).toEqual(['DISPOSED', 'DISPOSED']);
    expect(listeners.size).toBe(0);
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    expect(router.getDiagnostics()).toEqual({
      inflight: 0,
      recentCompleted: 0,
      maxPending: 32,
      disposed: true,
    });
    jobs[0].resolve('late');
    jobs[1].reject(new Error('late'));
    await flush();
    calls.forEach(call => expect(call.respond).toHaveBeenCalledTimes(1));
    expect(send({ action: 'probe' }).respond).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels before handler entry and tolerates disconnected response ports', async () => {
    const handler = vi.fn();
    const { send, chrome } = harness(handler);
    send();
    send({ action: 'cancel' });
    await flush();
    expect(handler).not.toHaveBeenCalled();
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    expect(() =>
      listener(
        { target: 'hhr-shared-offscreen', version: 1, action: 'probe', requestId: 'probe' },
        { id: 'extension-id' },
        () => {
          throw new Error('closed');
        }
      )
    ).not.toThrow();
  });

  it('enforces 32 inflight requests, recovers capacity and bounds recent IDs by count and TTL', async () => {
    const { send, router } = harness(() => new Promise(() => {}));
    for (let i = 0; i < 32; i++) send({ requestId: `load-${i}` });
    expect(router.getDiagnostics().inflight).toBe(32);
    expect(errorCode(send({ requestId: 'overflow' }))).toBe('CAPACITY_EXCEEDED');
    send({ action: 'cancel', requestId: 'load-0' });
    expect(send({ requestId: 'overflow' }).retained).toBe(true);
    router.dispose();
    const fast = harness();
    for (let i = 0; i < 260; i++) {
      fast.send({ requestId: `done-${i}` });
      await flush();
    }
    expect(fast.router.getDiagnostics().recentCompleted).toBe(256);
    expect(errorCode(fast.send({ requestId: 'done-259' }))).toBe('DUPLICATE_REQUEST');
    expect(fast.send({ requestId: 'done-0' }).retained).toBe(true);
    await flush();
    await vi.advanceTimersByTimeAsync(601_000);
    expect(fast.router.getDiagnostics().recentCompleted).toBe(0);
    expect(fast.send({ requestId: 'done-259' }).retained).toBe(true);
  });

  it.each([false, true])(
    'sanitizes handler errors (synchronous=%s), never forwards or persists payload',
    async synchronous => {
      const handler = () => {
        if (synchronous) throw new Error('clinical-payload');
        return Promise.reject(new Error('clinical-payload'));
      };
      const { send, router, chrome } = harness(handler);
      const call = send();
      await flush();
      expect(errorCode(call)).toBe('HANDLER_ERROR');
      expect(JSON.stringify(call.respond.mock.calls)).not.toContain('clinical-payload');
      expect(JSON.stringify(router.getDiagnostics())).not.toContain('clinical-payload');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
