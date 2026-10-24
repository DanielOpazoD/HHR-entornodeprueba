import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
  return {
    ...actual,
    doc: vi.fn(() => ({ __ref: 'doc' })),
    collection: vi.fn(() => ({ __ref: 'collection' })),
    getDoc: vi.fn(),
    getDocFromServer: vi.fn(),
    getDocs: vi.fn(),
    getDocsFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    query: vi.fn((...args: unknown[]) => ({ args })),
    where: vi.fn((...args: unknown[]) => ({ args })),
    orderBy: vi.fn((...args: unknown[]) => ({ args })),
  };
});

import { getDoc, getDocs, getDocsFromServer, onSnapshot } from 'firebase/firestore';
import {
  getMonthRecordsFromFirestore,
  getRecordFromFirestoreDetailed,
  getRecordsRangeFromFirestore,
  subscribeToRecord,
} from '@/services/storage/firestore/firestoreRecordQueries';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { getRecordForDate } from '@/services/storage/indexeddb/indexedDbRecordService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDailyRecordQueryFn } from '@/hooks/controllers/dailyRecordQueryController';
import { resolveDailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  expectedReviewedR1,
  IDENTITY_REVIEW_DATE as DATE,
  storedDay,
  storedDayWithPlantedReviews,
  storedSnapshot,
  syntheticIdentity,
} from '@/tests/fixtures/identityReviewDayFixture';

const R1_REVIEW = { bedId: 'R1', slot: 'bed', fields: ['documentType'] };

/** The day stays readable; only R1's unreadable document type is under review. */
const expectReviewedDay = (record: DailyRecord | null | undefined) => {
  expect(record?.beds.R1).toMatchObject(expectedReviewedR1());
  expect(record?.beds.R1.documentType).toBeUndefined();
  expect(record?.beds.R1.identityReview).toEqual(R1_REVIEW);
  expect(record?.beds.R2).toMatchObject(syntheticIdentity('R2', 'PACIENTE DOS', '11.111.111-1'));
  expect(record?.beds.R3.identityReview).toBeUndefined();
};

const captureSnapshotListener = () => {
  let next: ((snapshot: unknown) => void) | undefined;
  vi.mocked(onSnapshot).mockImplementation(((
    _ref: unknown,
    _options: unknown,
    listener: (snapshot: unknown) => void
  ) => {
    next = listener;
    return () => undefined;
  }) as never);
  return (snapshot: unknown) => next?.(snapshot);
};

beforeEach(async () => {
  vi.clearAllMocks();
  setFirestoreEnabled(true);
  await hospitalDB.dailyRecords.clear();
});

describe('a census day where one bed has an unreadable stored identity', () => {
  it('reads from Firestore as resolved, with the bed under review', async () => {
    vi.mocked(getDoc).mockResolvedValue(storedSnapshot(storedDay()) as never);

    const read = await getRecordFromFirestoreDetailed(DATE);

    expect(read.status).toBe('resolved');
    expectReviewedDay(read.record);
  });

  it('opens on a device without a local copy and keeps the review in the local copy', async () => {
    vi.mocked(getDoc).mockResolvedValue(storedSnapshot(storedDay()) as never);

    const result = await getForDateWithMeta(DATE, true);

    expectReviewedDay(result.record);
    expect(result.migrationRulesApplied).toContain('salvage_patient_fallback_applied');
    expectReviewedDay(await getRecordForDate(DATE));
  });

  it('reaches the census screen as a ready record, not as a remote timeout', async () => {
    vi.mocked(getDoc).mockResolvedValue(storedSnapshot(storedDay()) as never);

    const query = await createDailyRecordQueryFn({ getForDateWithMeta } as never, DATE, true)();
    const phase = resolveDailyRecordBootstrapPhase({
      remoteSyncStatus: 'ready',
      record: query.record,
      runtime: query.runtime,
      gracePeriodExpired: query.runtime.availabilityState === 'temporarily_unavailable',
      currentDateString: DATE,
      isFetching: false,
      isError: false,
    });

    expect(phase).toBe('record_ready');
    expectReviewedDay(query.record);
  });

  it('keeps reading offline from its own local copy after a reload', async () => {
    vi.mocked(getDoc).mockResolvedValue(storedSnapshot(storedDay()) as never);
    await getForDateWithMeta(DATE, true);

    const offline = await getForDateWithMeta(DATE, false);

    expect(offline.source).toBe('indexeddb');
    expectReviewedDay(offline.record);
    expect(offline.migrationRulesApplied).toContain('salvage_patient_fallback_applied');
  });

  it('names each reviewed bed and crib in the recovered issues of the migration report', () => {
    const newborn = syntheticIdentity('R1', 'RN SINTETICO', 'FAKE-PASSPORT-RN', { rut: 99 });
    const report = migrateLegacyDataWithReport(
      storedDay({ documentType: 'Cedula', clinicalCrib: newborn }) as never,
      DATE
    );

    expect(report.recoveredIssues).toEqual(
      expect.arrayContaining([
        'patient_identity_review:R1:documentType',
        'patient_identity_review:R1:clinicalCrib:rut',
      ])
    );
  });

  it('reads offline a local copy that holds the unreadable value itself', async () => {
    await hospitalDB.dailyRecords.put(storedDay() as never);

    const offline = await getForDateWithMeta(DATE, false);

    expectReviewedDay(offline.record);
  });

  it('delivers every realtime snapshot to the census', async () => {
    const emit = captureSnapshotListener();
    const delivered: Array<DailyRecord | null> = [];
    subscribeToRecord(DATE, record => delivered.push(record));

    expect(() => emit(storedSnapshot(storedDay()))).not.toThrow();
    emit(storedSnapshot(storedDay({ documentType: 'Pasaporte' })));

    expect(delivered).toHaveLength(2);
    expectReviewedDay(delivered[0]);
    expect(delivered[1]?.beds.R1.identityReview).toBeUndefined();
    expect(delivered[1]?.beds.R1.documentType).toBe('Pasaporte');
  });

  it('delivers the realtime snapshot through the repository subscription', async () => {
    const emit = captureSnapshotListener();
    const delivered: Array<DailyRecord | null> = [];
    const stop = subscribeDetailed(DATE, result => delivered.push(result.record));

    emit(storedSnapshot(storedDay()));
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    stop();

    expectReviewedDay(delivered[0]);
  });

  it('keeps the day in a range read and in the month that feeds email, Excel and backups', async () => {
    const docs = ['2026-10-22', '2026-10-23', '2026-10-24'].map(date => ({
      id: date,
      data: () =>
        storedDay(date === '2026-10-23' ? undefined : { documentType: 'Pasaporte' }, { date }),
    }));
    vi.mocked(getDocs).mockResolvedValue({ docs, size: 3 } as never);
    vi.mocked(getDocsFromServer).mockResolvedValue({ docs, size: 3 } as never);

    const range = await getRecordsRangeFromFirestore('2026-10-01', '2026-10-31');
    const month = await getMonthRecordsFromFirestore(2026, 9);

    for (const days of [range, month]) {
      expect(days.map(record => record.date)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
      expect(days[1].beds.R1.identityReview).toEqual(R1_REVIEW);
      expect(days[1].beds.R1.documentType).toBeUndefined();
    }
  });
});

describe('a review left in Firestore by any writer', () => {
  /** No review reaches the record, and every planted holder still arrives. */
  const expectNoStoredReview = (record: DailyRecord | null | undefined) => {
    expect(JSON.stringify(record)).not.toContain('identityReview');
    expect(record?.beds.R2.clinicalCrib?.patientName).toBe('RN SINTETICO');
    expect(record?.discharges[0].originalData?.clinicalCrib?.patientName).toBe('RN SINTETICO');
    expect(record?.transfers[0].originalData?.patientName).toBe('PACIENTE UNO');
    expect(record?.cma[0].originalData?.rut).toBe('FAKE-PASSPORT-R1');
  };

  it('never reaches a read, the local copy, the realtime census, a range or the month', async () => {
    vi.mocked(getDoc).mockResolvedValue(storedSnapshot(storedDayWithPlantedReviews()) as never);
    const docs = [{ id: DATE, data: () => storedDayWithPlantedReviews() }];
    vi.mocked(getDocs).mockResolvedValue({ docs, size: 1 } as never);
    vi.mocked(getDocsFromServer).mockResolvedValue({ docs, size: 1 } as never);
    const emit = captureSnapshotListener();
    const delivered: Array<DailyRecord | null> = [];
    subscribeToRecord(DATE, record => delivered.push(record));
    emit(storedSnapshot(storedDayWithPlantedReviews()));

    expectNoStoredReview((await getRecordFromFirestoreDetailed(DATE)).record);
    expectNoStoredReview((await getForDateWithMeta(DATE, true)).record);
    expectNoStoredReview(await getRecordForDate(DATE));
    expectNoStoredReview(delivered[0]);
    expectNoStoredReview((await getRecordsRangeFromFirestore('2026-10-01', '2026-10-31'))[0]);
    expectNoStoredReview((await getMonthRecordsFromFirestore(2026, 9))[0]);
  });
});
