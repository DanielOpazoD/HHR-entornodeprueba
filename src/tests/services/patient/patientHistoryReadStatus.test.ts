import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const {
  getAllRecords,
  getAllRecordsFromFirestore,
  getRecordsRangeFromFirestore,
  saveRecords,
  isFirestoreEnabled,
} = vi.hoisted(() => ({
  getAllRecords: vi.fn(),
  getAllRecordsFromFirestore: vi.fn(),
  getRecordsRangeFromFirestore: vi.fn(),
  saveRecords: vi.fn(),
  isFirestoreEnabled: vi.fn(),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getAllRecords,
  saveRecords,
}));
vi.mock('@/services/storage/firestore', () => ({
  getAllRecordsFromFirestore,
  getRecordsRangeFromFirestore,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled }));
import { getPatientMovementHistoryDetailed } from '@/services/patient/patientHistoryService';
const buildRecord = (date: string, overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({ date, beds: {}, discharges: [], transfers: [], cma: [], ...overrides }) as DailyRecord;

describe('patient movement history read status', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isFirestoreEnabled.mockReturnValue(true);
  });
  it('distinguishes unavailable empty local history from authoritative empty server history', async () => {
    getAllRecords.mockResolvedValue({});
    getAllRecordsFromFirestore.mockRejectedValueOnce(new Error('offline'));
    await expect(getPatientMovementHistoryDetailed('test-1')).resolves.toEqual({
      history: null,
      source: 'local',
    });
    getAllRecordsFromFirestore.mockResolvedValueOnce({});
    await expect(getPatientMovementHistoryDetailed('test-1')).resolves.toEqual({
      history: null,
      source: 'server',
    });
    expect(getAllRecordsFromFirestore).toHaveBeenCalledWith({ requireServer: true });
  });

  it('does not resurrect locally cached days removed on the server or write the census cache', async () => {
    getAllRecords.mockResolvedValue({
      '2026-04-07': buildRecord('2026-04-07', {
        beds: { R1: { rut: 'test-1', patientName: 'Synthetic' } as never },
      }),
    });
    getAllRecordsFromFirestore.mockResolvedValue({});
    await expect(getPatientMovementHistoryDetailed('test-1')).resolves.toEqual({
      history: null,
      source: 'server',
    });
    expect(getAllRecords).not.toHaveBeenCalled();
    expect(saveRecords).not.toHaveBeenCalled();
  });

  it('returns useful local movements with explicit partial provenance after a remote failure', async () => {
    getAllRecords.mockResolvedValue({
      '2026-04-07': buildRecord('2026-04-07', {
        beds: { R1: { rut: 'test-1', patientName: 'Synthetic' } as never },
      }),
    });
    getAllRecordsFromFirestore.mockRejectedValue(new Error('offline'));
    const result = await getPatientMovementHistoryDetailed('test-1');
    expect(result.source).toBe('local');
    expect(result.history?.movements).toHaveLength(1);
  });
  it('distinguishes configured local-only operation from a failed remote read', async () => {
    isFirestoreEnabled.mockReturnValue(false);
    getAllRecords.mockResolvedValue({});
    await expect(getPatientMovementHistoryDetailed('test-1')).resolves.toEqual({
      history: null,
      source: 'local-only',
    });
    expect(getAllRecordsFromFirestore).not.toHaveBeenCalled();
  });
});
