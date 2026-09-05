import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  requestClinicalPanel,
  RAYEN_CLINICAL_PANEL_RESULT_TYPE,
} from '@/features/rayen-import/bridge/clinicalPanelBridge';

describe('clinical panel request lifetime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('releases its message listener and timeout immediately when closed', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const remove = vi.spyOn(window, 'removeEventListener');
    const controller = new AbortController();
    const pending = requestClinicalPanel('episode-a', 30000, controller.signal);
    expect(post).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect((await pending).error).toBeTruthy();
  });

  it('does not dispatch an already cancelled request', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const controller = new AbortController();
    controller.abort();
    expect((await requestClinicalPanel('episode-a', 30000, controller.signal)).error).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not accumulate listeners or timers across 30 open/close cycles', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    for (let cycle = 0; cycle < 30; cycle++) {
      const controller = new AbortController();
      const pending = requestClinicalPanel('synthetic-episode', 30000, controller.signal);
      controller.abort();
      await pending;
    }
    const added = add.mock.calls
      .filter(([event]) => event === 'message')
      .map(([, listener]) => listener);
    const removed = remove.mock.calls
      .filter(([event]) => event === 'message')
      .map(([, listener]) => listener);
    expect(added).toHaveLength(30);
    expect(removed).toEqual(added);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts only the matching response from this window and cleans up on success', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const pending = requestClinicalPanel('episode-a');
    const reqId = post.mock.calls[0][0].reqId;
    const reply = (source: Window | null, id = reqId, origin = window.location.origin) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source,
          origin,
          data: { type: RAYEN_CLINICAL_PANEL_RESULT_TYPE, reqId: id, events: [], documents: [] },
        })
      );
    reply(null);
    reply(window, 'old-request');
    reply(window, reqId, 'https://untrusted.example');
    expect(vi.getTimerCount()).toBe(1);
    reply(window);
    expect(await pending).toMatchObject({ events: [], documents: [] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up on timeout and on dispatch failure', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const remove = vi.spyOn(window, 'removeEventListener');
    const pending = requestClinicalPanel('episode-a', 50);
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).error).toContain('Tiempo de espera');
    post.mockImplementation(() => {
      throw new Error('dispatch unavailable');
    });
    expect((await requestClinicalPanel('episode-b')).error).toBeTruthy();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
