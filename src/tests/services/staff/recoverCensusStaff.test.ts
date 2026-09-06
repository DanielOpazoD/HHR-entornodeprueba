import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pages: vi.fn(), save: vi.fn(), local: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  documentId: vi.fn(),
  query: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  startAfter: vi.fn(),
  getDocsFromServer: mocks.pages,
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: vi.fn() },
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getAllRecords: mocks.local,
}));
vi.mock('@/services/staff/eloisaStaffRegistry', () => ({ saveDiscoveredStaff: mocks.save }));
import { recoverCensusStaff } from '@/services/staff/recoverCensusStaff';
const page = (size: number) => ({
  size,
  docs: Array.from({ length: size }, (_, index) => ({
    id: `2026-09-${String(index + 1).padStart(2, '0')}`,
    data: () => ({ nursesDayShift: ['Ana Soto'], beds: {} }),
  })),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.local.mockResolvedValue({ old: { date: '2020-01-01', tensDayShift: ['Berta Historica'] } });
  mocks.save.mockResolvedValue([]);
});
describe('historical census recovery', () => {
  it('paginates the server, includes local past records and publishes once after a complete read', async () => {
    mocks.pages.mockResolvedValueOnce(page(50)).mockResolvedValueOnce(page(0));
    const result = await recoverCensusStaff(vi.fn());
    expect(mocks.pages).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ nurseCount: 1, tensCount: 1 });
    expect(mocks.save.mock.calls[0][0].map((entry: { name: string }) => entry.name)).toEqual([
      'Ana Soto',
      'Berta Historica',
    ]);
  });
  it('does not publish a partial scan when a later page fails', async () => {
    mocks.pages.mockResolvedValueOnce(page(50)).mockRejectedValueOnce(new Error('offline'));
    await expect(recoverCensusStaff(vi.fn())).rejects.toThrow('offline');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('allows cancellation before any shared write', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(recoverCensusStaff(vi.fn(), controller.signal)).rejects.toThrow();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
