import { describe, expect, it, vi } from 'vitest';
import { readPendingCudyrEpisodes } from '@/services/storage/sync/cudyrPendingRead';
const mocks = vi.hoisted(() => ({
  listAll: vi.fn(),
  owner: vi.fn(() => 'owner'),
  generation: vi.fn(() => 'generation'),
}));
vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({ ensureDbReady: vi.fn() }));
vi.mock('@/services/storage/sync/dexieSyncQueueStore', () => ({
  createDexieSyncQueueStore: () => ({ listAll: mocks.listAll }),
}));
vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  getStoredSessionOwnerKey: mocks.owner,
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: mocks.generation,
}));
describe('read-only pending CUDYR view', () => {
  const row = {
    ownerKey: 'owner',
    type: 'ARCHIVE_CUDYR',
    status: 'FAILED',
    payload: {
      request: {
        authorityDate: '2026-10-04',
        capture: { clinicalEpisodeId: 'episode' },
        evaluations: [{ recordedAt: '2026-10-03T03:00:00-05:00' }],
      },
    },
  };
  it('includes failed pending capture dates but not another owner or unowned legacy payloads', async () => {
    mocks.listAll.mockResolvedValue([
      row,
      { ...row, ownerKey: 'other' },
      { ...row, ownerKey: undefined },
    ]);
    expect(await readPendingCudyrEpisodes()).toEqual([
      { clinicalEpisodeId: 'episode', dates: ['2026-10-04', '2026-10-02'] },
    ]);
    expect(mocks.listAll).toHaveBeenCalledWith('owner');
  });
  it('discards a result if the session changes during its read', async () => {
    mocks.owner.mockReturnValueOnce('owner').mockReturnValueOnce('another');
    await expect(readPendingCudyrEpisodes()).rejects.toThrow('sesión cambió');
  });
});
