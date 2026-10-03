import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WoundCarePhoto } from '@/types/domain/woundCare';
import { useWoundCarePhotoCount } from '@/features/wound-care/hooks/useWoundCarePhotoCount';
import { WoundCarePhotoRepository } from '@/services/repositories/WoundCarePhotoRepository';
import { logger } from '@/services/utils/loggerService';

vi.mock('@/services/repositories/WoundCarePhotoRepository', () => ({
  WoundCarePhotoRepository: { listByEpisode: vi.fn() },
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

  it('does not query without an episode', async () => {
    const { result } = renderHook(() => useWoundCarePhotoCount(undefined));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(result.current).toBe(0);
    expect(WoundCarePhotoRepository.listByEpisode).not.toHaveBeenCalled();
  });

  it('does not display the previous episode count while the next episode loads or is absent', async () => {
    const { result, rerender } = renderHook(
      ({ episode }: { episode: string | undefined }) => useWoundCarePhotoCount(episode),
      { initialProps: { episode: 'episode-a' as string | undefined } }
    );
    await act(async () => {});
    expect(result.current).toBe(1);
    const next = deferred();
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockReturnValueOnce(next.promise);
    rerender({ episode: 'episode-b' });
    expect(result.current).toBe(0);
    await act(async () => {
      next.resolve(photos);
    });
    expect(result.current).toBe(1);
    rerender({ episode: undefined });
    expect(result.current).toBe(0);
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
    expect(result.current).toBe(1);
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockResolvedValueOnce([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(0);
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
    expect(result.current).toBe(0);
  });

  it('allows the next poll after a rejected read', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.mocked(WoundCarePhotoRepository.listByEpisode).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useWoundCarePhotoCount('episode-a'));
    await act(async () => {});
    expect(warn).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current).toBe(1);
    expect(WoundCarePhotoRepository.listByEpisode).toHaveBeenCalledTimes(2);
  });
});
