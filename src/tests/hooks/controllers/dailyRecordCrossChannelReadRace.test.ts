import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { DocumentData, SnapshotMetadata } from 'firebase/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';

type SyntheticSnapshot = {
  metadata: SnapshotMetadata;
  exists: () => boolean;
  data: () => DocumentData;
};

const sdk = vi.hoisted(() => ({
  listeners: [] as Array<{ next: (snapshot: SyntheticSnapshot) => void }>,
  pointReads: [] as Array<{
    resolve: (snapshot: SyntheticSnapshot) => void;
    reject: (error: unknown) => void;
  }>,
}));

vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: vi.fn(() => ({ id: 'synthetic-records' })),
  doc: vi.fn((_collection: unknown, id: string) => ({ id })),
  getDoc: vi.fn(
    () =>
      new Promise<SyntheticSnapshot>((resolve, reject) => {
        sdk.pointReads.push({ resolve, reject });
      })
  ),
  getDocFromServer: vi.fn(() => Promise.reject(new Error('Unexpected SDK server read'))),
  onSnapshot: vi.fn(
    (_reference: unknown, _options: unknown, next: (snapshot: SyntheticSnapshot) => void) => {
      sdk.listeners.push({ next });
      return vi.fn();
    }
  ),
}));

import { DataFactory } from '@/tests/factories/DataFactory';
import { DailyRecordSchema } from '@/schemas/zod/dailyRecord';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import {
  subscribeDetailed,
  syncWithFirestoreDetailed,
} from '@/services/repositories/dailyRecordRepositorySyncService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  createDailyRecordSubscription,
  createDailyRecordQueryOptions,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  getDailyRecordLastRemoteConfirmedAt,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';

const date = '2026-10-29';
const STAFF = {
  C0: ['ENFERMERA SINTETICA BASE 1', 'ENFERMERA SINTETICA BASE 2'],
  A: ['ENFERMERA SINTETICA A 1', 'ENFERMERA SINTETICA A 2'],
  B: ['ENFERMERA SINTETICA B 1', 'ENFERMERA SINTETICA B 2'],
};

const censusVersion = (lastUpdated: string, nursesDayShift: string[]): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    lastUpdated,
    nursesDayShift,
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'PACIENTE SINTETICO CARRERA',
        admissionDate: date,
        admissionTime: '08:00',
        pathology: 'DIAGNOSTICO SINTETICO ESTABLE',
      }),
    },
  });

const confirmedDocument = (record: DailyRecord, revision: number): SyntheticSnapshot => ({
  exists: () => true,
  data: () => ({ ...record, meta: { revision } }),
  metadata: { fromCache: false, hasPendingWrites: false, isEqual: () => false },
});

describe('confirmed manual read A completing after confirmed realtime B', () => {
  let queryClient: QueryClient;
  const subscriptions: Array<() => void> = [];
  const queryKey = getDailyRecordQueryKey(date);

  beforeEach(async () => {
    sdk.listeners.length = 0;
    sdk.pointReads.length = 0;
    localStorage.clear();
    setFirestoreEnabled(true);
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    resetDailyRecordFreshnessGateForTests();
    clearPendingDailyRecordPatchesForTests();
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  });

  afterEach(async () => {
    for (const stop of subscriptions.splice(0)) stop();
    queryClient.clear();
    vi.restoreAllMocks();
    resetDailyRecordFreshnessGateForTests();
    clearPendingDailyRecordPatchesForTests();
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });

  const visible = () => queryClient.getQueryData<DailyRecordQueryResult>(queryKey);
  const stored = () => hospitalDB.dailyRecords.get(date);

  const seedBase = async (lastUpdated = '2026-10-29T11:00:00.000Z') => {
    const base = censusVersion(lastUpdated, STAFF.C0);
    expect(DailyRecordSchema.safeParse(base).success).toBe(true);
    await hospitalDB.dailyRecords.put(base);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
    return base;
  };

  const startManualRead = () =>
    queryClient.fetchQuery({
      ...createDailyRecordQueryOptions({ getForDateWithMeta }, date, queryClient),
      staleTime: 0,
    });

  const startRealtime = () => {
    const stop = createDailyRecordSubscription(
      { getForDateWithMeta, subscribeDetailed },
      date,
      queryClient
    );
    if (!stop) throw new Error('The real subscription controller did not start');
    subscriptions.push(stop);
    const listener = sdk.listeners.at(-1);
    if (!listener) throw new Error('The real Firestore wrapper did not subscribe to the SDK');
    return listener;
  };

  it('control: a sequential confirmed read A without a concurrent B reaches both stores', async () => {
    await seedBase();
    const recordA = censusVersion('2026-10-29T12:00:00.000Z', STAFF.A);
    expect(DailyRecordSchema.safeParse(recordA).success).toBe(true);

    const manualRead = startManualRead();
    await vi.waitFor(() => expect(sdk.pointReads).toHaveLength(1));
    sdk.pointReads[0].resolve(confirmedDocument(recordA, 10));
    const result = await manualRead;

    expect(result.record?.nursesDayShift).toEqual(STAFF.A);
    expect(result.runtime.serverConfirmed).toBe(true);
    expect(visible()?.record?.nursesDayShift).toEqual(STAFF.A);
    expect((await stored())?.nursesDayShift).toEqual(STAFF.A);
  });

  const races = [
    {
      name: 'A older timestamp than B',
      a: '2026-10-29T12:00:00.000Z',
      b: '2026-10-29T12:05:00.000Z',
    },
    {
      name: 'A and B equal timestamps',
      a: '2026-10-29T12:05:00.000Z',
      b: '2026-10-29T12:05:00.000Z',
    },
    {
      name: 'A clock ahead of B (inversion)',
      a: '2026-10-29T12:10:00.000Z',
      b: '2026-10-29T12:05:00.000Z',
    },
  ];

  it.each(races)('$name: B survives in QueryClient and IndexedDB', async ({ a, b }) => {
    await seedBase();
    const recordA = censusVersion(a, STAFF.A);
    const recordB = censusVersion(b, STAFF.B);
    expect(DailyRecordSchema.safeParse(recordA).success).toBe(true);
    expect(DailyRecordSchema.safeParse(recordB).success).toBe(true);

    const manualRead = startManualRead();
    await vi.waitFor(() => expect(sdk.pointReads).toHaveLength(1));
    const heldA = sdk.pointReads[0];

    const listener = startRealtime();
    listener.next(confirmedDocument(recordB, 11));
    await vi.waitFor(() => {
      expect(visible()?.record?.nursesDayShift).toEqual(STAFF.B);
      expect(visible()?.runtime.serverConfirmed).toBe(true);
    });
    await vi.waitFor(async () => expect((await stored())?.nursesDayShift).toEqual(STAFF.B));
    expect(await hospitalDB.syncQueue.count()).toBe(0);
    const confirmedAt = getDailyRecordLastRemoteConfirmedAt(date);

    heldA.resolve(confirmedDocument(recordA, 10));
    const result = await manualRead;

    expect
      .soft(visible()?.record?.nursesDayShift, 'QueryClient keeps confirmed realtime B')
      .toEqual(STAFF.B);
    expect
      .soft((await stored())?.nursesDayShift, 'IndexedDB keeps confirmed realtime B')
      .toEqual(STAFF.B);
    expect(result.record?.nursesDayShift).toEqual(STAFF.B);
    expect(visible()?.runtime.serverConfirmed).toBe(true);
    expect(getDailyRecordLastRemoteConfirmedAt(date)).toBe(confirmedAt);
  });

  it('a sync joining the old GET inherits its issuer base even after realtime B', async () => {
    await seedBase();
    const recordA = censusVersion('2026-10-29T12:05:00.000Z', STAFF.A);
    const recordB = censusVersion('2026-10-29T12:05:00.000Z', STAFF.B);
    const manual = startManualRead();
    await vi.waitFor(() => expect(sdk.pointReads).toHaveLength(1));
    startRealtime().next(confirmedDocument(recordB, 11));
    await vi.waitFor(() => expect(visible()?.record?.nursesDayShift).toEqual(STAFF.B));
    const reads = vi.spyOn(hospitalDB.dailyRecords, 'get');
    const sync = syncWithFirestoreDetailed(date);
    await vi.waitFor(() => expect(reads).toHaveResolvedTimes(1));
    expect(sdk.pointReads).toHaveLength(1);
    sdk.pointReads[0].resolve(confirmedDocument(recordA, 10));
    const [, result] = await Promise.all([manual, sync]);
    expect(result).toMatchObject({ serverConfirmed: false, publication: 'superseded' });
    expect(result?.record?.nursesDayShift).toEqual(STAFF.B);
    expect((await stored())?.nursesDayShift).toEqual(STAFF.B);
    expect(visible()?.record?.nursesDayShift).toEqual(STAFF.B);
  });

  it('compares the raw local base before migration adds defaults', async () => {
    const {
      rayenSyncHistory: _history,
      nursesNightShift: _night,
      tensDayShift: _tens,
      ...legacy
    } = censusVersion('2026-10-29T11:00:00.000Z', STAFF.C0);
    await hospitalDB.table<unknown, string>('dailyRecords').put(legacy);
    const fresh = censusVersion('2026-10-29T12:00:00.000Z', STAFF.A);
    const read = startManualRead();
    await vi.waitFor(() => expect(sdk.pointReads).toHaveLength(1));
    sdk.pointReads[0].resolve(confirmedDocument(fresh, 11));
    await read;
    expect(visible()?.record?.nursesDayShift).toEqual(STAFF.A);
    expect((await stored())?.nursesDayShift).toEqual(STAFF.A);
    expect(visible()?.runtime.serverConfirmed).toBe(true);
  });

  it.each([11, undefined])(
    'a subsequent read progresses without a newer revision: %s',
    async revision => {
      await seedBase();
      const b = censusVersion('2026-10-29T12:05:00.000Z', STAFF.B);
      startRealtime().next(confirmedDocument(b, 11));
      await vi.waitFor(() => expect(visible()?.record?.nursesDayShift).toEqual(STAFF.B));
      const next = censusVersion('2026-10-29T12:06:00.000Z', STAFF.A);
      const read = startManualRead();
      await vi.waitFor(() => expect(sdk.pointReads).toHaveLength(1));
      sdk.pointReads[0].resolve(
        revision === undefined
          ? { ...confirmedDocument(next, 11), data: () => next }
          : confirmedDocument(next, revision)
      );
      await read;
      expect(visible()?.record?.nursesDayShift).toEqual(STAFF.A);
      expect((await stored())?.nursesDayShift).toEqual(STAFF.A);
      expect(visible()?.runtime.serverConfirmed).toBe(true);
    }
  );
});
