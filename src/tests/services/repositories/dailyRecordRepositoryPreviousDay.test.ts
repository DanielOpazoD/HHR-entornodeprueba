import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPreviousDay,
  getPreviousDayWithMeta,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { getPreviousDayRecord } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getPreviousRecordDateFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
  captureLocalRecordBase: vi.fn(),
  getPreviousDayRecord: vi.fn(),
  getAllDates: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getPreviousRecordDateFromFirestore: vi.fn(),
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(),
}));
vi.mock('@/services/storage/sync/dailyRecordSyncQueueReadService', () => ({
  getDailyRecordWriteStateForVersion: vi.fn(),
  hasUnresolvedDailyRecordWriteForDate: vi.fn(),
}));

const buildRecord = (date: string, lastUpdated: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
    activeExtraBeds: [],
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNightReceives: [],
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    schemaVersion: 1,
  }) as DailyRecord;

describe('previous-day lookup availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
    vi.mocked(getPreviousDayRecord).mockResolvedValue(null);
  });

  it('distinguishes a failed remote lookup from a confirmed missing census', async () => {
    vi.mocked(getPreviousRecordDateFromFirestore).mockRejectedValueOnce(
      Object.assign(new Error('Synthetic unavailable'), { code: 'unavailable' })
    );

    const result = await getPreviousDayWithMeta('2026-03-20');

    expect(result).toMatchObject({
      record: null,
      serverConfirmed: false,
      consistencyState: 'unavailable',
      retryability: 'automatic_retry',
      conflictSummary: { kind: 'remote_unavailable' },
    });
  });

  it('keeps missing when the remote lookup succeeds without a previous date', async () => {
    vi.mocked(getPreviousRecordDateFromFirestore).mockResolvedValueOnce(null);
    expect(await getPreviousDayWithMeta('2026-03-20')).toMatchObject({
      record: null,
      consistencyState: 'missing',
      conflictSummary: { kind: 'remote_missing' },
    });
  });

  it('returns the local previous census without querying the server', async () => {
    vi.mocked(getPreviousDayRecord).mockResolvedValueOnce(
      buildRecord('2026-03-19', '2026-03-19T12:00:00.000Z')
    );
    expect(await getPreviousDayWithMeta('2026-03-20')).toMatchObject({
      record: { date: '2026-03-19' },
      source: 'indexeddb',
    });
    expect(getPreviousRecordDateFromFirestore).not.toHaveBeenCalled();
  });

  it('preserves missing and skips remote lookup when Firestore is disabled', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    expect(await getPreviousDayWithMeta('2026-03-20')).toMatchObject({
      record: null,
      consistencyState: 'missing',
    });
    expect(getPreviousRecordDateFromFirestore).not.toHaveBeenCalled();
  });

  it('preserves the legacy nullable result on unavailable lookup', async () => {
    vi.mocked(getPreviousRecordDateFromFirestore).mockRejectedValueOnce(
      Object.assign(new Error('Synthetic unavailable'), { code: 'unavailable' })
    );
    expect(await getPreviousDay('2026-03-20')).toBeNull();
  });
});
