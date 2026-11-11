import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/storage/firestore/dailyRecordSizeTelemetry', () => ({
  observeDailyRecordServerSnapshot: vi.fn(),
}));

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  return {
    ...actual,
    getDocs: vi.fn(),
    getDocsFromServer: vi.fn(),
    orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
    query: vi.fn((...args: unknown[]) => ({ args })),
    where: vi.fn((field: string, op: string, value: string) => ({ field, op, value })),
  };
});

vi.mock('@/firebaseConfig', () => ({ db: {} }));

vi.mock('@/constants/firestorePaths', () => ({
  COLLECTIONS: { HOSPITALS: 'hospitals' },
  getActiveHospitalId: vi.fn(() => 'hanga_roa'),
}));

vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  docToRecord: vi.fn((data: Record<string, unknown>, id: string) => ({ date: id, ...data })),
  getRecordDocRef: vi.fn((date: string) => ({ date })),
  getRecordsCollection: vi.fn(() => 'records-collection'),
}));

vi.mock('@/services/storage/storageLoggers', () => ({
  firestoreQueryLogger: { error: vi.fn() },
}));

const rangeStorage = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), download: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordsRange: rangeStorage.read,
  saveRecordsStrict: rangeStorage.save,
}));
vi.mock(
  '@/services/storage/firestore',
  async () => import('@/services/storage/firestore/firestoreRecordQueries')
);
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: vi.fn(),
}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'synthetic@example.test',
}));
vi.mock('@/services/exporters/clinicalDerivedBackupSection', () => ({
  buildClinicalDerivedBackupSection: vi.fn(),
  describeIncompleteClinicalDerivedBackup: vi.fn(),
}));
vi.mock('file-saver', () => ({ saveAs: rangeStorage.download }));

import { getDocs, getDocsFromServer } from 'firebase/firestore';
import { getRecordsRangeFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { syncRecordsRange } from '@/services/records/recordQueryService';
import { hydrateRangeRecords } from '@/services/admin/dataMaintenanceSupport';
import {
  exportMonthRecordsWithOutcome,
  exportYearToDateRecordsWithOutcome,
} from '@/services/admin/dataMaintenanceService';

const localDay = { date: '2026-04-02', beds: {}, lastUpdated: '2026-04-02T12:00:00Z' };

describe('a remote range read that fails is not an empty range', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rangeStorage.read.mockResolvedValue([localDay]);
    rangeStorage.save.mockImplementation(async records => ({ ok: true, records }));
  });

  it('rejects a failed cache-capable range read but accepts a genuinely empty range', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({ docs: [] } as never);
    await expect(getRecordsRangeFromFirestore('2026-04-01', '2026-04-30')).resolves.toEqual([]);
    const failure = new Error('synthetic remote failure');
    vi.mocked(getDocs).mockRejectedValueOnce(failure);
    await expect(getRecordsRangeFromFirestore('2026-04-01', '2026-04-30')).rejects.toBe(failure);
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it.each([syncRecordsRange, hydrateRangeRecords])(
    'propagates a failed SDK read through %s without storing or returning a partial range',
    async readRange => {
      const failure = new Error('synthetic remote failure');
      vi.mocked(getDocs).mockRejectedValueOnce(failure);
      await expect(readRange('2026-04-01', '2026-04-30')).rejects.toBe(failure);
      expect(rangeStorage.save).not.toHaveBeenCalled();
      expect(getDocsFromServer).not.toHaveBeenCalled();
    }
  );

  it.each(['month', 'year'])(
    'abstains from the %s backup after an SDK failure even with local records',
    async scope => {
      vi.mocked(getDocs).mockRejectedValueOnce(new Error('synthetic remote failure'));
      const result = await (scope === 'month'
        ? exportMonthRecordsWithOutcome(2026, 4)
        : exportYearToDateRecordsWithOutcome(2026));
      expect(result).toMatchObject({ status: 'failed', reason: 'unknown', data: null });
      expect(rangeStorage.download).not.toHaveBeenCalled();
      expect(rangeStorage.save).not.toHaveBeenCalled();
    }
  );
});
