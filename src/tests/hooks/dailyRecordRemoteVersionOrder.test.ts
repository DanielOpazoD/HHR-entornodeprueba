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

import {
  createDailyRecordQueryOptions,
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';

const date = '2026-10-29';
const STAFF = {
  A: ['ENFERMERA SINTETICA A 1', 'ENFERMERA SINTETICA A 2'],
  B: ['ENFERMERA SINTETICA B 1', 'ENFERMERA SINTETICA B 2'],
};
const CLOCK_A = '2026-10-29T12:05:00.000Z';
const CLOCK_B = {
  ascending: '2026-10-29T12:06:00.000Z',
  equal: CLOCK_A,
  inverted: '2026-10-29T12:00:00.000Z',
};

const censusVersion = (lastUpdated: string, nursesDayShift: string[]): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    lastUpdated,
    nursesDayShift,
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'PACIENTE SINTETICO ORDEN',
        admissionDate: date,
        admissionTime: '08:00',
        pathology: 'DIAGNOSTICO SINTETICO ESTABLE',
      }),
    },
  });

const confirmed = (record: DailyRecord, revision?: number): SyntheticSnapshot => ({
  exists: () => true,
  data: () => (revision === undefined ? record : { ...record, meta: { revision } }),
  metadata: { fromCache: false, hasPendingWrites: false, isEqual: () => false },
});

describe('the order of two confirmed versions of a day', () => {
  let queryClient: QueryClient;
  const subscriptions: Array<() => void> = [];
  const queryKey = getDailyRecordQueryKey(date);
  const visible = () =>
    queryClient.getQueryData<DailyRecordQueryResult>(queryKey)?.record?.nursesDayShift;
  const stored = async () => (await hospitalDB.dailyRecords.get(date))?.nursesDayShift;

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

  const read = async (snapshot: SyntheticSnapshot) => {
    const pending = queryClient.fetchQuery({
      ...createDailyRecordQueryOptions({ getForDateWithMeta }, date, queryClient),
      staleTime: 0,
    });
    await vi.waitFor(() => expect(sdk.pointReads.length).toBeGreaterThan(0));
    sdk.pointReads.splice(0, 1)[0].resolve(snapshot);
    await pending;
  };

  const listen = () => {
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

  const settle = () => new Promise(resolve => setTimeout(resolve, 50));

  describe.each([
    ['the listener', (b: SyntheticSnapshot) => (listen().next(b), settle())],
    ['a later read', (b: SyntheticSnapshot) => read(b)],
  ] as const)('reaching this device through %s', (_path, observe) => {
    it.each(['ascending', 'equal', 'inverted'] as const)(
      'a higher revision wins with a %s clock, on screen and on disk',
      async clock => {
        await read(confirmed(censusVersion(CLOCK_A, STAFF.A), 10));
        await observe(confirmed(censusVersion(CLOCK_B[clock], STAFF.B), 11));
        await vi.waitFor(async () => {
          expect(visible()).toEqual(STAFF.B);
          expect(await stored()).toEqual(STAFF.B);
        });
        // The next write compares against these: they must be the server's, not a mix.
        expect(await hospitalDB.dailyRecords.get(date)).toMatchObject({
          lastUpdated: CLOCK_B[clock],
          meta: { revision: 11 },
        });
      }
    );

    it.each([
      ['the same', 10, 10],
      ['no', undefined, undefined],
      ['only one known', 10, undefined],
      ['only the new one known', undefined, 11],
    ] as const)('with %s revision the clock still decides', async (_case, revisionA, revisionB) => {
      await read(confirmed(censusVersion(CLOCK_A, STAFF.A), revisionA));
      await observe(confirmed(censusVersion(CLOCK_B.ascending, STAFF.B), revisionB));
      await vi.waitFor(async () => {
        expect(visible()).toEqual(STAFF.B);
        expect(await stored()).toEqual(STAFF.B);
      });
    });

    it.each([
      ['the same', 10, 10],
      ['no', undefined, undefined],
      ['only one known', 10, undefined],
      ['only the new one known', undefined, 11],
      ['a lower', 11, 10],
    ] as const)(
      'with %s revision a behind clock does not replace what is shown',
      async (_case, revisionA, revisionB) => {
        await read(confirmed(censusVersion(CLOCK_A, STAFF.A), revisionA));
        await observe(confirmed(censusVersion(CLOCK_B.inverted, STAFF.B), revisionB));
        await settle();
        expect(visible()).toEqual(STAFF.A);
        expect(await stored()).toEqual(STAFF.A);
      }
    );

    it('a higher revision does not replace a day write still waiting to be sent', async () => {
      const edit = censusVersion(CLOCK_A, STAFF.A);
      await read(confirmed(edit, 10));
      await hospitalDB.syncQueue.add({
        opId: 'synthetic-pending',
        type: 'UPDATE_DAILY_RECORD',
        key: `daily:${date}`,
        payload: edit,
        timestamp: Date.parse(CLOCK_A),
        retryCount: 0,
        status: 'PENDING',
      });
      await observe(confirmed(censusVersion(CLOCK_B.inverted, STAFF.B), 11));
      await settle();
      expect(visible()).toEqual(STAFF.A);
      expect(await stored()).toEqual(STAFF.A);
      expect((await hospitalDB.syncQueue.toArray())[0]?.payload).toMatchObject({
        nursesDayShift: STAFF.A,
      });
    });
  });
});
