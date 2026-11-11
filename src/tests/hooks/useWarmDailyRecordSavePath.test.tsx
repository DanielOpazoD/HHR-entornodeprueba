import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const loaders = vi.hoisted(() => ({
  save: vi.fn(),
  write: vi.fn(),
  outbox: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/application/ports/dailyRecordPort', () => ({
  loadDailyRecordWriteService: loaders.write,
}));
vi.mock('@/services/storage/sync/dexieSyncQueueStore', () => ({
  loadDailyRecordOutbox: loaders.outbox,
}));
vi.mock('@/hooks/controllers/dailyRecordSavePersistenceController', () => {
  loaders.save();
  return {};
});
vi.mock('@/services/repositories/repositoryLoggers', () => ({
  dailyRecordWriteLogger: { warn: loaders.warn },
}));
import { useWarmDailyRecordSavePath } from '@/hooks/useWarmDailyRecordSavePath';

describe('authenticated save path preload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loaders.write.mockResolvedValue({});
    loaders.outbox.mockResolvedValue({});
  });
  it('loads once on mount, without repeating on renders or online after success', async () => {
    const { rerender, unmount } = renderHook(() => useWarmDailyRecordSavePath());
    await waitFor(() => expect(loaders.outbox).toHaveBeenCalledTimes(1));
    await act(async () => {});
    rerender();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(loaders.write).toHaveBeenCalledTimes(1);
    unmount();
  });
  it('silently retries failed loading on online and removes the listener on unmount', async () => {
    loaders.write.mockRejectedValueOnce(new Error('synthetic offline module'));
    const { unmount } = renderHook(() => useWarmDailyRecordSavePath());
    await waitFor(() => expect(loaders.warn).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(loaders.write).toHaveBeenCalledTimes(2);
    expect(loaders.outbox).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(loaders.write).toHaveBeenCalledTimes(2);
  });
});
