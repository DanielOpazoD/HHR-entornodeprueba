import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDicomInstance } from '@/services/radiology/mmradDicomService';
vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: async () => ({}),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('DICOM transfer diagnostics and retry classification', () => {
  it('reports numeric timing only and keeps responses out of persistent HTTP caches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        headers: { 'Content-Type': 'application/dicom', 'Server-Timing': 'upstream;dur=12.5' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const timing = vi.fn();
    expect(
      await fetchDicomInstance('synthetic-ticket', new AbortController().signal, timing)
    ).toEqual(new Uint8Array([1, 2]));
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
    expect(timing.mock.calls[0][0]).toMatchObject({ upstream: 12.5, upstreamSamples: 1 });
    expect(Object.values(timing.mock.calls[0][0]).every(value => typeof value === 'number')).toBe(
      true
    );
  });
  it.each([
    [429, true],
    [503, true],
    [502, true],
    [401, false],
    [403, false],
    [422, false],
  ])('classifies HTTP %s without echoing response content', async (status, transient) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"error":"private server detail"}', {
          status: Number(status),
          headers: { 'Retry-After': '3' },
        })
      )
    );
    const result = fetchDicomInstance('synthetic-ticket', new AbortController().signal);
    await expect(result).rejects.toMatchObject({ transient, retryAfterMs: 3000 });
    await expect(result).rejects.not.toThrow('private');
  });
  it('retries a body-read AbortError when the patient session was not cancelled', async () => {
    const response = new Response(new Uint8Array([1]), {
      headers: { 'Content-Type': 'application/dicom' },
    });
    vi.spyOn(response, 'arrayBuffer').mockRejectedValue(
      new DOMException('Body interrupted', 'AbortError')
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(
      fetchDicomInstance('synthetic-ticket', new AbortController().signal)
    ).rejects.toMatchObject({ transient: true });
  });

  it('propagates user cancellation without classifying it as retryable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
              once: true,
            });
          })
      )
    );
    // AbortSignal.timeout uses native time; a parent cancellation must propagate immediately.
    const controller = new AbortController();
    const task = fetchDicomInstance('synthetic-ticket', controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });
});
