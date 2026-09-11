// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../extension/syslab-offscreen-transport.js';

type Relay = {
  request: (
    message: { type: string },
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ) => Promise<unknown>;
  getDiagnostics: () => { pending: number; disposed: boolean };
  dispose: () => void;
};
const create = (
  globalThis as typeof globalThis & {
    HhrSyslabOffscreenTransport: { create: (dependencies: unknown) => Relay };
  }
).HhrSyslabOffscreenTransport.create;

const harness = () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const frameListeners = new Map<string, () => void>();
  const frame = {
    contentWindow: { postMessage: vi.fn() },
    addEventListener: (name: string, callback: () => void) => frameListeners.set(name, callback),
    removeEventListener: (name: string) => frameListeners.delete(name),
  };
  const windowApi = {
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  };
  const relay = create({ frame, window: windowApi });
  const respond = (index: number, response: unknown, overrides: Record<string, unknown> = {}) => {
    const request = frame.contentWindow.postMessage.mock.calls[index][0];
    listeners.get('message')?.({
      source: frame.contentWindow,
      origin: 'http://10.4.69.90',
      data: { type: 'HHR_SYSLAB_FRAME_RESULT', reqId: request.reqId, response },
      ...overrides,
    });
  };
  return { relay, frame, listeners, frameListeners, respond };
};
const status = { type: 'RAYEN_SYSLAB_STATUS' };

afterEach(() => vi.useRealTimers());

describe('shared-document Syslab iframe relay', () => {
  it('correlates simultaneous replies delivered out of order', async () => {
    const h = harness();
    const first = h.relay.request(status);
    const second = h.relay.request(status);
    const calls = h.frame.contentWindow.postMessage.mock.calls;
    expect(calls[0][0].reqId).not.toBe(calls[1][0].reqId);
    expect(calls[0][1]).toBe('http://10.4.69.90');
    h.respond(1, { marker: 'second' });
    h.respond(0, { marker: 'first' });
    await expect(first).resolves.toEqual({ marker: 'first' });
    await expect(second).resolves.toEqual({ marker: 'second' });
    expect(h.relay.getDiagnostics().pending).toBe(0);
    h.relay.dispose();
  });

  it('ignores wrong-origin, wrong-window, unknown and duplicate replies', async () => {
    const h = harness();
    const request = h.relay.request(status);
    h.respond(0, { marker: 'wrong' }, { origin: 'https://example.invalid' });
    h.respond(0, { marker: 'wrong' }, { source: {} });
    h.respond(
      0,
      { marker: 'wrong' },
      { data: { type: 'HHR_SYSLAB_FRAME_RESULT', reqId: 'unknown' } }
    );
    expect(h.relay.getDiagnostics().pending).toBe(1);
    h.respond(0, { marker: 'correct' });
    h.respond(0, { marker: 'duplicate' });
    await expect(request).resolves.toEqual({ marker: 'correct' });
    h.relay.dispose();
  });

  it('cancels and drops late results without replaying an operation', async () => {
    const h = harness();
    const controller = new AbortController();
    const request = h.relay.request({ type: 'RAYEN_SYSLAB_LOGIN' }, { signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({ code: 'SYSLAB_REQUEST_CANCELLED' });
    controller.abort();
    await rejected;
    h.respond(0, { marker: 'late' });
    expect(h.relay.getDiagnostics().pending).toBe(0);
    expect(h.frame.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    h.relay.dispose();
  });

  it('does not dispatch an already aborted request', async () => {
    const h = harness();
    await expect(h.relay.request(status, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: 'SYSLAB_REQUEST_CANCELLED',
    });
    expect(h.frame.contentWindow.postMessage).not.toHaveBeenCalled();
    h.relay.dispose();
  });

  it('times out once, cleans memory and does not resend', async () => {
    vi.useFakeTimers();
    const h = harness();
    const request = h.relay.request(status, { timeoutMs: 250 });
    const rejected = expect(request).rejects.toMatchObject({ code: 'SYSLAB_REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(251);
    await rejected;
    expect(h.frame.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(h.relay.getDiagnostics().pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    h.relay.dispose();
  });

  it('invalidates requests on frame navigation instead of attaching them to the new page', async () => {
    const h = harness();
    const old = h.relay.request(status);
    const rejected = expect(old).rejects.toMatchObject({ code: 'SYSLAB_FRAME_NAVIGATED' });
    h.frameListeners.get('load')?.();
    await rejected;
    const current = h.relay.request(status);
    h.respond(0, { marker: 'old-page' });
    expect(h.relay.getDiagnostics().pending).toBe(1);
    h.respond(1, { marker: 'current-page' });
    await expect(current).resolves.toEqual({ marker: 'current-page' });
    h.relay.dispose();
  });

  it('disposes all listeners, pending work and timers', async () => {
    vi.useFakeTimers();
    const h = harness();
    const request = h.relay.request(status);
    const rejected = expect(request).rejects.toMatchObject({ code: 'SYSLAB_FRAME_DISPOSED' });
    h.relay.dispose();
    h.relay.dispose();
    await rejected;
    expect(h.listeners.size).toBe(0);
    expect(h.frameListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(h.relay.request(status)).rejects.toMatchObject({
      code: 'SYSLAB_FRAME_UNAVAILABLE',
    });
  });

  it('bounds pending messages and refuses unsupported operations', async () => {
    const h = harness();
    const requests = Array.from({ length: 32 }, () =>
      h.relay.request(status).catch(error => error.code)
    );
    await expect(h.relay.request(status)).rejects.toMatchObject({ code: 'SYSLAB_REQUEST_LIMIT' });
    await expect(h.relay.request({ type: 'UNSUPPORTED' })).rejects.toMatchObject({
      code: 'SYSLAB_OPERATION_UNSUPPORTED',
    });
    expect(h.frame.contentWindow.postMessage).toHaveBeenCalledTimes(32);
    h.relay.dispose();
    await Promise.all(requests);
  });

  it('cleans up a postMessage transport error', async () => {
    const h = harness();
    h.frame.contentWindow.postMessage.mockImplementation(() => {
      throw new Error('transport');
    });
    await expect(h.relay.request(status)).rejects.toMatchObject({
      code: 'SYSLAB_FRAME_UNAVAILABLE',
    });
    expect(h.relay.getDiagnostics().pending).toBe(0);
    h.relay.dispose();
  });
});
