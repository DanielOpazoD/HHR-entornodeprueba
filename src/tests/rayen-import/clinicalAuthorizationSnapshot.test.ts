import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestClinicalAuthorizationSnapshot } from '@/features/rayen-import/bridge/clinicalAuthorizationSnapshot';
import {
  requestRayenSyncBundle,
  subscribeToRayenSnapshots,
} from '@/features/rayen-import/bridge/rayenSnapshotBridge';

const stamp = '2026-10-16T02:00:00.000Z';
const snapshot = {
  facilityId: 1,
  capturedAt: stamp,
  isComplete: true,
  encounters: [],
  clinicalCoverage: {
    total: 0,
    completed: 0,
    errors: 0,
    headerErrors: 0,
    diagnosisErrors: 0,
    isolationErrors: 0,
  },
};
const bundle = {
  id: 'bundle',
  startedAt: stamp,
  completedAt: stamp,
  facilityId: 1,
  dateStart: '2026-10-15',
  dateEnd: '2026-10-16',
  fichaMedicoCapturedAt: stamp,
  gestionCamasCapturedAt: stamp,
  sourceSkewMs: 0,
  egresoRows: [],
};
const deliver = (requestId: string, extra = {}, origin = window.location.origin) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin,
      data: { type: 'HHR_RAYEN_CENSUS_SNAPSHOT', requestId, snapshot, bundle, ...extra },
    })
  );

describe('read-only clinical authorization capture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(stamp));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses the Rapa Nui calendar and preserves the ordinary census request correlation', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const normalResult = vi.fn();
    const unsubscribe = subscribeToRayenSnapshots(normalResult);
    try {
      const normalId = requestRayenSyncBundle('2026-10-15', '2026-10-16');
      const pending = requestClinicalAuthorizationSnapshot(new AbortController().signal);
      const request = post.mock.calls[1][0];
      expect(request).toMatchObject({ dateStart: '2026-10-15', dateEnd: '2026-10-16' });
      expect(request.requestId).not.toBe(normalId);
      deliver(request.requestId);
      expect(await pending).toEqual(snapshot);
      expect(normalResult).not.toHaveBeenCalled();
      deliver(normalId);
      expect(normalResult).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('ignores another request or origin and cancels only its timed-out capture', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const pending = requestClinicalAuthorizationSnapshot(new AbortController().signal, 10);
    const requestId = post.mock.calls[0][0].requestId;
    deliver('another-request');
    deliver(requestId, {}, 'https://foreign.invalid');
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toBeNull();
    expect(post.mock.calls[1][0]).toEqual({ type: 'HHR_RAYEN_CANCEL_SYNC_BUNDLE', requestId });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { snapshot: { ...snapshot, isComplete: false } },
    { bundle: { ...bundle, facilityId: 2 } },
    { bundle: { ...bundle, dateEnd: '2026-10-17' } },
    { snapshot: { ...snapshot, capturedAt: '2026-10-16T01:59:59.000Z' } },
  ])('rejects incomplete, mismatched or unbound source evidence', async extra => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const pending = requestClinicalAuthorizationSnapshot(new AbortController().signal);
    deliver(post.mock.calls[0][0].requestId, extra);
    expect(await pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a cancelled capture and cleans up a broken message transport', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {
      throw new Error('Relay gone');
    });
    const controller = new AbortController();
    controller.abort();
    await expect(requestClinicalAuthorizationSnapshot(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(post).not.toHaveBeenCalled();
    expect(await requestClinicalAuthorizationSnapshot(new AbortController().signal)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
