import { afterEach, expect, it, vi } from 'vitest';
import { createDicomDownloadQueue } from '@/services/radiology/dicomDownloadQueue';
import { DicomTransferError } from '@/services/radiology/dicomLoadState';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('keeps the retry scheduled when the clock crosses its deadline during the queue pump', async () => {
  vi.useFakeTimers({ now: 1000 });
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const download = vi
    .fn()
    .mockRejectedValueOnce(new DicomTransferError(true, 0))
    .mockResolvedValue(new Uint8Array([1]));
  const controller = new AbortController();
  const queue = createDicomDownloadQueue(
    1,
    controller.signal,
    download,
    async () => 'image',
    vi.fn(),
    vi.fn()
  );
  try {
    const ready = queue.request(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(download).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().retries).toBe(1);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1499).mockReturnValue(1500);
    await vi.advanceTimersByTimeAsync(501);
    expect(download).toHaveBeenCalledTimes(2);
    await expect(ready).resolves.toBe('image');
  } finally {
    controller.abort();
    await queue.settled;
  }
});
