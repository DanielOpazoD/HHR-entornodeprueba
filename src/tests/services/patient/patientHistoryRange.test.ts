// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { allLocal, rangeLocal, allRemote, rangeRemote } = vi.hoisted(() => ({
  allLocal: vi.fn(),
  rangeLocal: vi.fn(),
  allRemote: vi.fn(),
  rangeRemote: vi.fn(),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getAllRecords: allLocal,
  getRecordsRange: rangeLocal,
}));
vi.mock('@/services/storage/firestore', () => ({
  getRecordPagesFromFirestore: async function* () {
    yield Object.values(await allRemote({ requireServer: true }));
  },
  getAllRecordsFromFirestore: allRemote,
  getRecordsRangeFromFirestore: rangeRemote,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
import { getPatientMovementHistoryDetailed } from '@/services/patient/patientHistoryService';

describe('bounded patient history reads', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rangeRemote.mockResolvedValue([]);
    rangeLocal.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());
  const dateRange = { startDate: '2026-03-06', endDate: '2026-03-08' };
  it('reads only the requested server period, with no full scan or local hydration', async () => {
    await getPatientMovementHistoryDetailed('test-1', { dateRange });
    expect(rangeRemote).toHaveBeenCalledExactlyOnceWith('2026-03-06', '2026-03-08', {
      requireServer: true,
    });
    expect(allRemote).not.toHaveBeenCalled();
    expect(allLocal).not.toHaveBeenCalled();
    expect(rangeLocal).not.toHaveBeenCalled();
  });
  it('keeps the same bounded period when the server is unavailable', async () => {
    rangeRemote.mockRejectedValueOnce(new Error('offline'));
    expect((await getPatientMovementHistoryDetailed('test-1', { dateRange })).source).toBe('local');
    expect(rangeLocal).toHaveBeenCalledExactlyOnceWith('2026-03-06', '2026-03-08');
    expect(allRemote).not.toHaveBeenCalled();
    expect(allLocal).not.toHaveBeenCalled();
  });
  it('allows an explicit full history request despite a supplied period', async () => {
    allRemote.mockResolvedValue({});
    await getPatientMovementHistoryDetailed('test-1', {
      dateRange,
      forceFullRemoteHydration: true,
    });
    expect(allRemote).toHaveBeenCalledExactlyOnceWith({ requireServer: true });
    expect(rangeRemote).not.toHaveBeenCalled();
  });
  it.each([
    { startDate: '2026-02-30', endDate: '2026-03-08' },
    { startDate: '2026-03-09', endDate: '2026-03-08' },
    { startDate: '', endDate: '2026-03-08' },
  ])('rejects invalid ranges before any query: %j', async dateRange => {
    await expect(getPatientMovementHistoryDetailed('test-1', { dateRange })).rejects.toThrow(
      'Invalid history date range'
    );
    expect(rangeRemote).not.toHaveBeenCalled();
    expect(allRemote).not.toHaveBeenCalled();
    expect(allLocal).not.toHaveBeenCalled();
  });
  it('uses the hospital calendar and does not cap a readmission at a prior discharge', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T02:00:00Z'));
    await getPatientMovementHistoryDetailed('test-1', {
      lastAdmission: '2026-09-27',
      lastDischarge: '2026-09-26',
    });
    expect(rangeRemote).toHaveBeenCalledExactlyOnceWith('2026-09-27', '2026-09-27', {
      requireServer: true,
    });
  });
});
