import React from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WoundCarePhoto } from '@/types/domain/woundCare';
import { WoundCarePhotoCountProvider } from '@/features/wound-care/hooks/WoundCarePhotoCountContext';
import { useWoundCarePhotoCount } from '@/features/wound-care/hooks/useWoundCarePhotoCount';
import { WoundCarePhotoRepository } from '@/features/wound-care/services/WoundCarePhotoRepository';
import { logger } from '@/services/utils/loggerService';

vi.mock('@/features/wound-care/services/WoundCarePhotoRepository', () => ({
  WoundCarePhotoRepository: {
    listByEpisode: vi.fn(),
    countByEpisodeKeys: vi.fn(),
  },
}));

const buildPhoto = (id: string, uploadedAt: string): WoundCarePhoto => ({
  id,
  patientRut: '11.111.111-1',
  patientName: 'Paciente Test',
  episodeKey: '11111111-1__2026-05-02',
  storagePath: `wound-care/photos/${id}.webp`,
  thumbnailStoragePath: `wound-care/thumbnails/${id}.webp`,
  downloadUrl: `https://example.test/${id}.webp`,
  thumbnailDownloadUrl: `https://example.test/${id}_thumb.webp`,
  mimeType: 'image/webp',
  originalFileSize: 1000,
  compressedFileSize: 500,
  width: 800,
  height: 600,
  takenAt: uploadedAt,
  uploadedAt,
  uploadedBy: {
    uid: 'u1',
    email: 'test@hospital.cl',
    displayName: 'Usuario Test',
    role: 'admin',
  },
  isDeleted: false,
});

const photos = [buildPhoto('one', '2026-05-02T10:00:00Z')];
const deferred = () => {
  let resolve!: (photos: WoundCarePhoto[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<WoundCarePhoto[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useWoundCarePhotoCount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockReset().mockResolvedValue(photos);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('distinguishes pending and unavailable reads from a confirmed empty result', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const pending = deferred();
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useWoundCarePhotoCount('episode-a'));
    expect(result.current).toEqual({ status: 'loading', previousCount: null });
    await act(async () => pending.reject(new Error('offline')));
    expect(result.current).toEqual({ status: 'unavailable', previousCount: null });

    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockResolvedValueOnce([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(result.current).toEqual({ status: 'ready', count: 0 });
  });

  it.each([0, 1])(
    'preserves a confirmed count of %s during refresh and failure for the same episode',
    async count => {
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.mocked(WoundCarePhotoRepository.listByEpisode).mockResolvedValueOnce(count ? photos : []);
      const { result, rerender } = renderHook(
        ({ token, episode }) => useWoundCarePhotoCount(episode, token),
        { initialProps: { token: 0, episode: 'episode-a' } }
      );
      await act(async () => {});
      expect(result.current).toEqual({ status: 'ready', count });

      const refresh = deferred();
      vi.mocked(WoundCarePhotoRepository.listByEpisode).mockReturnValueOnce(refresh.promise);
      rerender({ token: 1, episode: 'episode-a' });
      expect(result.current).toEqual({ status: 'loading', previousCount: count });
      await act(async () => refresh.reject(new Error('offline')));
      expect(result.current).toEqual({ status: 'unavailable', previousCount: count });

      vi.mocked(WoundCarePhotoRepository.listByEpisode).mockRejectedValueOnce(new Error('offline'));
      await act(async () => rerender({ token: 1, episode: 'episode-b' }));
      expect(result.current).toEqual({ status: 'unavailable', previousCount: null });
    }
  );

  it('skips hidden polling and refreshes once when visible again', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { result, unmount } = renderHook(() => useWoundCarePhotoCount('episode-a'));
    await act(async () => {});
    expect(result.current).toEqual({ status: 'ready', count: 1 });

    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(1);

    const pending = deferred();
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockReturnValueOnce(pending.promise);
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending.resolve([]);
    });
    expect(result.current).toEqual({ status: 'ready', count: 0 });
    unmount();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
  });

  it('defers an initially hidden episode until visible, using the latest selection', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { result, rerender } = renderHook(({ episode }) => useWoundCarePhotoCount(episode), {
      initialProps: { episode: 'episode-a' },
    });
    rerender({ episode: 'episode-b' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(WoundCarePhotoRepository.listByEpisode).not.toHaveBeenCalled();
    expect(result.current).toEqual({ status: 'loading', previousCount: null });
    visibility.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledExactlyOnceWith('episode-b');
    expect(result.current).toEqual({ status: 'ready', count: 1 });
  });

  it('does not query without an episode', async () => {
    const { result } = renderHook(() => useWoundCarePhotoCount(undefined));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(result.current).toEqual({ status: 'idle' });
    expect(WoundCarePhotoRepository.listByEpisode).not.toHaveBeenCalled();
  });

  it('does not display the previous episode count while the next episode loads or is absent', async () => {
    const { result, rerender } = renderHook(
      ({ episode }: { episode: string | undefined }) => useWoundCarePhotoCount(episode),
      { initialProps: { episode: 'episode-a' as string | undefined } }
    );
    await act(async () => {});
    expect(result.current).toEqual({ status: 'ready', count: 1 });
    const next = deferred();
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockReturnValueOnce(next.promise);
    rerender({ episode: 'episode-b' });
    expect(result.current).toEqual({ status: 'loading', previousCount: null });
    await act(async () => {
      next.resolve(photos);
    });
    expect(result.current).toEqual({ status: 'ready', count: 1 });
    rerender({ episode: undefined });
    expect(result.current).toEqual({ status: 'idle' });
  });

  it('does not overlap slow polling reads and resumes after completion', async () => {
    const pending = deferred();
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(() => useWoundCarePhotoCount('episode-a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(photos);
    });
    expect(result.current).toEqual({ status: 'ready', count: 1 });
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockResolvedValueOnce([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ status: 'ready', count: 0 });
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
  });

  it('ignores a late response for the previous episode', async () => {
    const pending = deferred();
    vi.mocked(WoundCarePhotoRepository.listByEpisode)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce([]);
    const { result, rerender } = renderHook(({ episode }) => useWoundCarePhotoCount(episode), {
      initialProps: { episode: 'episode-a' },
    });
    await act(async () => {
      rerender({ episode: 'episode-b' });
    });
    await act(async () => {
      pending.resolve(photos);
    });
    expect(result.current).toEqual({ status: 'ready', count: 0 });
  });

  it('allows the next poll after a rejected read', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useWoundCarePhotoCount('episode-a'));
    await act(async () => {});
    expect(warn).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(result.current).toEqual({ status: 'ready', count: 1 });
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
  });

  it('refreshes every 5 minutes instead of every 30 seconds', async () => {
    renderHook(() => useWoundCarePhotoCount('episode-a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299_999);
    });
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
  });

  it('re-reads on tab return only when the count is older than a minute', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const switchTab = async (afterMs: number) => {
      visibility.mockReturnValue('hidden');
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(afterMs);
      });
      visibility.mockReturnValue('visible');
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    };
    renderHook(() => useWoundCarePhotoCount('episode-a'));
    await act(async () => {});

    await switchTab(30_000);
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(1);
    await switchTab(30_000);
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
  });

  it('re-reads right away when the caller asks for a refresh', async () => {
    const { result, rerender } = renderHook(
      ({ token }) => useWoundCarePhotoCount('episode-a', token),
      { initialProps: { token: 0 } }
    );
    await act(async () => {});
    expect(result.current).toEqual({ status: 'ready', count: 1 });
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockResolvedValueOnce([]);
    await act(async () => {
      rerender({ token: 1 });
    });
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ status: 'ready', count: 0 });
  });
});

describe('WoundCarePhotoCountProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockReset().mockResolvedValue(photos);
    vi.mocked(WoundCarePhotoRepository.countByEpisodeKeys)
      .mockReset()
      .mockResolvedValue({ 'ep-1': 2, 'ep-2': 0, 'ep-3': 1 });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('batches N episodes into one query, one interval, and one visibility listener, and isolates single-episode refreshes', async () => {
    const addListenerSpy = vi.spyOn(document, 'addEventListener');
    const renderCounts = { 'ep-1': 0, 'ep-2': 0, 'ep-3': 0 };
    const latestStates: Record<string, ReturnType<typeof useWoundCarePhotoCount>> = {};

    const Probe = React.memo(function Probe({
      episodeKey,
      token = 0,
    }: {
      episodeKey: 'ep-1' | 'ep-2' | 'ep-3';
      token?: number;
    }) {
      renderCounts[episodeKey] += 1;
      latestStates[episodeKey] = useWoundCarePhotoCount(episodeKey, token);
      return null;
    });

    const episodeKeys = ['ep-1', 'ep-2', 'ep-3'];
    const { rerender, unmount } = render(
      React.createElement(
        WoundCarePhotoCountProvider,
        { episodeKeys },
        React.createElement(Probe, { episodeKey: 'ep-1', token: 0 }),
        React.createElement(Probe, { episodeKey: 'ep-2', token: 0 }),
        React.createElement(Probe, { episodeKey: 'ep-3', token: 0 })
      )
    );

    await act(async () => {});

    expect(WoundCarePhotoRepository.countByEpisodeKeys).toHaveBeenCalledTimes(1);
    expect(WoundCarePhotoRepository.countByEpisodeKeys).toHaveBeenCalledWith([
      'ep-1',
      'ep-2',
      'ep-3',
    ]);
    expect(WoundCarePhotoRepository.listByEpisode).not.toHaveBeenCalled();
    const visibilityRegistrations = addListenerSpy.mock.calls.filter(
      ([type]) => type === 'visibilitychange'
    );
    expect(visibilityRegistrations).toHaveLength(1);
    expect(latestStates['ep-1']).toEqual({ status: 'ready', count: 2 });
    expect(latestStates['ep-2']).toEqual({ status: 'ready', count: 0 });
    expect(latestStates['ep-3']).toEqual({ status: 'ready', count: 1 });

    // Bumping refreshToken on ep-1 refreshes only ep-1 via listByEpisode and never re-renders ep-2/ep-3.
    const ep2RendersBefore = renderCounts['ep-2'];
    const ep3RendersBefore = renderCounts['ep-3'];
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockResolvedValueOnce([
      buildPhoto('a', '2026-05-02T10:00:00Z'),
      buildPhoto('b', '2026-05-02T10:01:00Z'),
      buildPhoto('c', '2026-05-02T10:02:00Z'),
    ]);

    rerender(
      React.createElement(
        WoundCarePhotoCountProvider,
        { episodeKeys },
        React.createElement(Probe, { episodeKey: 'ep-1', token: 1 }),
        React.createElement(Probe, { episodeKey: 'ep-2', token: 0 }),
        React.createElement(Probe, { episodeKey: 'ep-3', token: 0 })
      )
    );

    await act(async () => {});

    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledExactlyOnceWith('ep-1');
    expect(latestStates['ep-1']).toEqual({ status: 'ready', count: 3 });
    expect(renderCounts['ep-2']).toBe(ep2RendersBefore);
    expect(renderCounts['ep-3']).toBe(ep3RendersBefore);

    // 5-minute poll fires one batched read, not N per-row reads.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(WoundCarePhotoRepository.countByEpisodeKeys).toHaveBeenCalledTimes(2);
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('marks batched episodes unavailable on failure without collapsing to zero and preserves previousCount', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.mocked(WoundCarePhotoRepository.countByEpisodeKeys).mockRejectedValueOnce(
      new Error('offline')
    );

    const { result } = renderHook(() => useWoundCarePhotoCount('ep-1'), {
      wrapper: ({ children }) =>
        React.createElement(WoundCarePhotoCountProvider, { episodeKeys: ['ep-1'] }, children),
    });

    await act(async () => {});
    expect(result.current).toEqual({ status: 'unavailable', previousCount: null });

    vi.mocked(WoundCarePhotoRepository.countByEpisodeKeys).mockResolvedValueOnce({ 'ep-1': 4 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(result.current).toEqual({ status: 'ready', count: 4 });

    vi.mocked(WoundCarePhotoRepository.countByEpisodeKeys).mockRejectedValueOnce(
      new Error('network')
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(result.current).toEqual({ status: 'unavailable', previousCount: 4 });
  });

  it('ignores an older in-flight batch resolution for an episode refreshed more recently', async () => {
    let resolveBatch!: (value: Record<string, number>) => void;
    vi.mocked(WoundCarePhotoRepository.countByEpisodeKeys).mockReturnValueOnce(
      new Promise<Record<string, number>>(res => {
        resolveBatch = res;
      })
    );
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockResolvedValueOnce([
      buildPhoto('fresh-1', '2026-05-02T10:00:00Z'),
      buildPhoto('fresh-2', '2026-05-02T10:01:00Z'),
    ]);

    const { result, rerender } = renderHook(({ token }) => useWoundCarePhotoCount('ep-1', token), {
      initialProps: { token: 0 },
      wrapper: ({ children }) =>
        React.createElement(WoundCarePhotoCountProvider, { episodeKeys: ['ep-1'] }, children),
    });

    expect(result.current).toEqual({ status: 'loading', previousCount: null });

    // Modal closes and runs targeted refresh while initial batch is still pending.
    await act(async () => {
      rerender({ token: 1 });
    });
    expect(result.current).toEqual({ status: 'ready', count: 2 });

    // Stale batch resolves with older count 0; must not overwrite fresher count 2.
    await act(async () => {
      resolveBatch({ 'ep-1': 0 });
    });
    expect(result.current).toEqual({ status: 'ready', count: 2 });
  });
});
