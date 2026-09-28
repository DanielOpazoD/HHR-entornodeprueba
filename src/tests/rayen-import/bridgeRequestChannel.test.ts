import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestViaBridgeChannel } from '@/features/rayen-import/bridge/bridgeRequestChannel';

const reply = (reqId: string, origin = window.location.origin) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin,
      data: { type: 'RESULT', reqId, value: 'complete' },
    })
  );

describe('clinical read channel lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const setup = (signal?: AbortSignal) => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const mapResult = vi.fn(data => data.value as string);
    const onTimeout = vi.fn(() => 'timeout');
    const options = {
      prefix: 'test',
      requestType: 'REQUEST',
      resultType: 'RESULT',
      payload: {},
      timeoutMs: 55_000,
      mapResult,
      onTimeout,
      signal,
    };
    return { post, mapResult, onTimeout, options };
  };

  it('does not dispatch or allocate a timer when the stage is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { post, options } = setup(controller.signal);
    await expect(requestViaBridgeChannel(options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(post).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases listeners and timers on cancellation and ignores a late response', async () => {
    const controller = new AbortController();
    const { post, options, mapResult, onTimeout } = setup(controller.signal);
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeSignal = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = requestViaBridgeChannel(options);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    const reqId = post.mock.calls[0][0].reqId as string;
    controller.abort(new DOMException('Stage timeout', 'TimeoutError'));
    await rejection;
    reply(reqId);
    await vi.runAllTimersAsync();
    expect(mapResult).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
    expect(removeWindow).toHaveBeenCalledWith('message', expect.any(Function));
    expect(removeSignal).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts only the correlated same-origin response and settles once', async () => {
    const controller = new AbortController();
    const { post, options, mapResult, onTimeout } = setup(controller.signal);
    const pending = requestViaBridgeChannel(options);
    const reqId = post.mock.calls[0][0].reqId as string;
    reply('unrelated');
    reply(reqId, 'https://untrusted.example');
    expect(mapResult).not.toHaveBeenCalled();
    reply(reqId);
    reply(reqId);
    controller.abort();
    await expect(pending).resolves.toBe('complete');
    expect(mapResult).toHaveBeenCalledOnce();
    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a failing decoder instead of leaving a promise pending without its timer', async () => {
    const { post, options, mapResult } = setup();
    mapResult.mockImplementation(() => {
      throw new Error('invalid source response');
    });
    const pending = requestViaBridgeChannel(options);
    const rejection = expect(pending).rejects.toThrow('invalid source response');
    reply(post.mock.calls[0][0].reqId);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up when dispatch fails', async () => {
    const { post, options } = setup();
    post.mockImplementation(() => {
      throw new Error('transport unavailable');
    });
    await expect(requestViaBridgeChannel(options)).rejects.toThrow('transport unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles the timeout once and ignores a response after the deadline', async () => {
    const { post, options, onTimeout, mapResult } = setup();
    const pending = requestViaBridgeChannel(options);
    await vi.advanceTimersByTimeAsync(options.timeoutMs);
    await expect(pending).resolves.toBe('timeout');
    reply(post.mock.calls[0][0].reqId);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(mapResult).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
