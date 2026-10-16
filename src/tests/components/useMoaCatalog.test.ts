import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMoaCatalog } from '@/components/layout/moa/useMoaCatalog';
import {
  fetchMoaCatalog,
  parseMoaCatalog,
  readCachedMoaCatalog,
  type MoaCatalog,
} from '@/components/layout/moa/moaCatalog';
import fixture from '../fixtures/moa/catalog.json';
vi.mock('@/components/layout/moa/moaCatalog', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/layout/moa/moaCatalog')>()),
  fetchMoaCatalog: vi.fn(),
  readCachedMoaCatalog: vi.fn(),
}));
const cached = parseMoaCatalog(fixture);
const updated = { ...cached, version: 'a'.repeat(64) };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T00:00:00Z'));
  vi.mocked(readCachedMoaCatalog).mockReturnValue(cached);
  vi.mocked(fetchMoaCatalog).mockReset().mockResolvedValue(cached);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const visibility = () => act(() => document.dispatchEvent(new Event('visibilitychange')));
describe('Moa catalog refresh lifecycle', () => {
  it('waits for visibility, throttles attempts, then adopts new content without remounting', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const view = renderHook(useMoaCatalog);
    expect(fetchMoaCatalog).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    visibility();
    await act(async () => {});
    expect(fetchMoaCatalog).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(15 * 60_000 - 1));
    visibility();
    expect(fetchMoaCatalog).toHaveBeenCalledTimes(1);
    vi.mocked(fetchMoaCatalog).mockResolvedValue(updated);
    act(() => vi.advanceTimersByTime(1));
    visibility();
    await act(async () => {});
    expect(fetchMoaCatalog).toHaveBeenCalledTimes(2);
    expect(view.result.current?.version).toBe(updated.version);
    view.unmount();
  });
  it('aborts at six seconds and retains the last valid catalog', async () => {
    vi.mocked(fetchMoaCatalog).mockImplementation(() => new Promise(() => {}));
    const view = renderHook(useMoaCatalog);
    const signal = vi.mocked(fetchMoaCatalog).mock.calls[0][0];
    act(() => vi.advanceTimersByTime(5999));
    expect(signal.aborted).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(signal.aborted).toBe(true);
    expect(view.result.current).toBe(cached);
    view.unmount();
  });
  it('aborts on close, removes the visibility listener and ignores a late response', async () => {
    let resolve: (value: MoaCatalog) => void = () => {};
    vi.mocked(fetchMoaCatalog).mockImplementation(
      () =>
        new Promise(r => {
          resolve = r;
        })
    );
    const view = renderHook(useMoaCatalog);
    const signal = vi.mocked(fetchMoaCatalog).mock.calls[0][0];
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => resolve(updated));
    act(() => vi.advanceTimersByTime(15 * 60_000));
    visibility();
    expect(fetchMoaCatalog).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBe(cached);
  });
  it('preserves cache on failure and permits a later visibility retry', async () => {
    vi.mocked(fetchMoaCatalog).mockRejectedValueOnce(new Error('offline'));
    const view = renderHook(useMoaCatalog);
    await act(async () => {});
    expect(view.result.current).toBe(cached);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(15 * 60_000));
    vi.mocked(fetchMoaCatalog).mockResolvedValue(updated);
    visibility();
    await act(async () => {});
    expect(view.result.current).toBe(updated);
    view.unmount();
  });
});
