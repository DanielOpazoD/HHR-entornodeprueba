import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RayenClinicalPanelResult } from '@/features/rayen-import/bridge/clinicalPanelBridge';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/features/rayen-import', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/rayen-import')>()),
  requestClinicalPanel: (...args: unknown[]) => mocks.request(...args),
}));
import { useClinicalPanelSnapshot } from '@/features/census/components/patient-row/useClinicalPanelSnapshot';

const payload = (label: string): RayenClinicalPanelResult => ({
  events: [],
  carePlan: { carePlanHeaders: [], medicationStates: [] },
  documents: [
    {
      id: label,
      name: label,
      classification: '',
      fileName: '',
      attachedBy: '',
      facility: '',
      createdAt: '',
    },
  ],
});
const deferred = () => {
  let resolve!: (value: RayenClinicalPanelResult) => void;
  const promise = new Promise<RayenClinicalPanelResult>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('clinical panel snapshot ownership', () => {
  beforeEach(() => mocks.request.mockReset());

  it('coalesces repeated refresh clicks while the current request is pending', async () => {
    const pending = deferred();
    mocks.request.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useClinicalPanelSnapshot('episode-a'));
    act(() => {
      result.current.reload();
      result.current.reload();
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(payload('current')));
    expect(result.current.documentState).toMatchObject({
      phase: 'ready',
      documents: [{ id: 'current' }],
    });
  });

  it('clears the old snapshot and aborts an old reload when the episode changes', async () => {
    const stale = deferred();
    const next = deferred();
    mocks.request
      .mockResolvedValueOnce(payload('a'))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ episode }) => useClinicalPanelSnapshot(episode), {
      initialProps: { episode: 'a' },
    });
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    act(() => result.current.reload());
    const oldSignal = mocks.request.mock.calls[1][2] as AbortSignal;
    rerender({ episode: 'b' });
    expect(result.current.state.phase).toBe('loading');
    expect(result.current.documentState.phase).toBe('loading');
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => next.resolve(payload('b')));
    await act(async () => stale.resolve(payload('a-stale')));
    expect(result.current.documentState).toMatchObject({
      phase: 'ready',
      documents: [{ id: 'b' }],
    });
  });

  it('aborts on unmount and allows a fresh request on reopen', async () => {
    const pending = deferred();
    mocks.request.mockReturnValue(pending.promise);
    const first = renderHook(() => useClinicalPanelSnapshot('a'));
    const signal = mocks.request.mock.calls[0][2] as AbortSignal;
    first.unmount();
    expect(signal?.aborted).toBe(true);
    const second = renderHook(() => useClinicalPanelSnapshot('a'));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    second.unmount();
    await act(async () => pending.resolve(payload('late')));
  });

  it('turns a rejected request into a retryable error', async () => {
    mocks.request
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(payload('retry'));
    const { result } = renderHook(() => useClinicalPanelSnapshot('a'));
    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    expect(result.current.documentState.phase).toBe('error');
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
  });
});
