import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { CURRENT_SCHEMA_VERSION } from '@/constants/version';
import { resolveRemoteGoldenPathReadResult } from '@/services/repositories/dailyRecordRemoteReadController';
import { createLocalRuntimeReadCandidate } from '@/services/repositories/dailyRecordReadResultController';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { hospitalDB, isDatabaseInFallbackMode } from '@/services/storage/indexeddb/indexedDbCore';
import {
  getRecordForDateStrict,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { subscribeToRecord } from '@/services/storage/firestore/firestoreRecordQueries';
import type { DailyRecordRemoteLoadResult } from '@/services/repositories/dailyRecordRemoteLoader';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: vi.fn(),
}));

const date = '2026-10-26';
const baseTime = '2026-10-26T10:00:00.000Z';
const laterTime = '2026-10-26T10:02:00.000Z';
const readModes: Array<'ordinary' | 'realtime'> = ['ordinary', 'realtime'];
const unresolvedStates: Array<SyncTask['status']> = ['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT'];

const event = (overrides: Partial<RayenSyncEvent> = {}): RayenSyncEvent => ({
  id: 'synthetic-run',
  sourceDate: date,
  startedAt: '2026-10-26T09:58:00.000Z',
  completedAt: baseTime,
  by: 'SYNTHETIC OPERATOR',
  status: 'partial',
  ...overrides,
});

const reviewedEvent = (): RayenSyncEvent =>
  event({
    reviewRequirement: 'day_bootstrap',
    structuralReview: {
      structureConfirmed: true,
      historicalCorrectionsPending: false,
      historicalCorrectionsRequireFreshCapture: false,
      isolatedConflicts: 1,
      issues: [{ bedId: null, reason: 'unverified-report-row' }],
    },
  });

const record = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: baseTime,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rayenSyncHistory: [],
    ...overrides,
  });

const remoteLoad = (remote: DailyRecord): DailyRecordRemoteLoadResult => ({
  serverConfirmed: true,
  record: remote,
  source: 'firestore',
  compatibilityTier: 'current_firestore',
  compatibilityIntensity: 'none',
  migrationRulesApplied: [],
  cachedLocally: false,
});

const read = async (mode: (typeof readModes)[number], remote: DailyRecord) => {
  if (mode === 'ordinary') {
    const local = await getRecordForDateStrict(date);
    return resolveRemoteGoldenPathReadResult({
      date,
      localCandidate: local ? createLocalRuntimeReadCandidate(date, local) : null,
      remoteReadResult: remoteLoad(structuredClone(remote)),
    });
  }

  vi.mocked(subscribeToRecord).mockImplementationOnce((_date, callback) => {
    callback(structuredClone(remote), false, { fromCache: false, hasPendingWrites: false });
    return () => {};
  });
  let stop = () => {};
  const delivered = new Promise<SyncDailyRecordResult>(resolve => {
    stop = subscribeDetailed(date, result => resolve(result));
  });
  try {
    return await delivered;
  } finally {
    stop();
  }
};

const reopen = async () => {
  hospitalDB.close();
  await hospitalDB.open();
  expect(isDatabaseInFallbackMode()).toBe(false);
  const stored = await getRecordForDateStrict(date);
  expect(stored).not.toBeNull();
  return stored ? createLocalRuntimeReadCandidate(date, stored).record : null;
};

const seed = async (local: DailyRecord) => {
  expect(await saveRecordStrict(local)).toMatchObject({ ok: true, store: 'indexeddb' });
};

describe.each(readModes)('daily record history through %s reads and real cache hydration', mode => {
  beforeEach(async () => {
    await hospitalDB.open();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    vi.mocked(subscribeToRecord).mockReset();
  });

  afterEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    hospitalDB.close();
  });

  it.each([
    { label: 'equal record timestamp', lastUpdated: baseTime },
    { label: 'newer remote record', lastUpdated: laterTime },
  ])(
    'preserves remote review evidence with $label and unchanged event id/status/time',
    async ({ lastUpdated }) => {
      const expected = reviewedEvent();
      await seed(record({ rayenSyncHistory: [event()] }));

      const result = await read(mode, record({ lastUpdated, rayenSyncHistory: [expected] }));
      const reloaded = await reopen();

      expect.soft(result.record?.rayenSyncHistory, 'published event').toEqual([expected]);
      expect
        .soft(reloaded?.rayenSyncHistory, 'event after cache reopen and migration')
        .toEqual([expected]);
      expect(result.serverConfirmed).toBe(true);
    }
  );

  it.each([baseTime, laterTime])(
    'preserves different run ids from both sources in descending order at %s',
    async lastUpdated => {
      const oldest = event({ id: 'local-old', startedAt: '2026-10-26T09:00:00.000Z' });
      const middle = event({ id: 'remote-middle', startedAt: '2026-10-26T09:10:00.000Z' });
      const newest = event({ id: 'local-new', startedAt: '2026-10-26T09:20:00.000Z' });
      await seed(record({ rayenSyncHistory: [oldest, newest] }));

      const result = await read(mode, record({ lastUpdated, rayenSyncHistory: [middle] }));
      const expected = [newest, middle, oldest];

      expect(result.record?.rayenSyncHistory).toEqual(expected);
      expect((await reopen())?.rayenSyncHistory).toEqual(expected);
    }
  );

  it.each([baseTime, laterTime])(
    'keeps the newest 20 distinct runs across both sources after reopening at %s',
    async lastUpdated => {
      const runs = Array.from({ length: 25 }, (_, index) =>
        event({
          id: `synthetic-run-${index}`,
          startedAt: `2026-10-26T09:${String(index).padStart(2, '0')}:00.000Z`,
        })
      );
      await seed(record({ rayenSyncHistory: runs.filter((_, index) => index % 2 === 0) }));

      const result = await read(
        mode,
        record({ lastUpdated, rayenSyncHistory: runs.filter((_, index) => index % 2 === 1) })
      );
      const expectedIds = [
        24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5,
      ].map(index => `synthetic-run-${index}`);

      expect(result.record?.rayenSyncHistory?.map(run => run.id)).toEqual(expectedIds);
      expect((await reopen())?.rayenSyncHistory?.map(run => run.id)).toEqual(expectedIds);
    }
  );

  it.each([baseTime, laterTime])(
    'keeps remote review evidence while protecting a local narrative at %s',
    async lastUpdated => {
      const patient = DataFactory.createMockPatient('R1', {
        patientName: 'SYNTHETIC PATIENT',
        clinicalEpisodeId: 'synthetic-episode',
        admissionDate: date,
        handoffNote: 'SYNTHETIC LOCAL NARRATIVE WITH COMPLETE DETAILS',
      });
      await seed(record({ beds: { R1: patient }, rayenSyncHistory: [event()] }));
      const expected = reviewedEvent();
      const result = await read(
        mode,
        record({
          lastUpdated,
          beds: { R1: { ...patient, handoffNote: 'SHORT' } },
          rayenSyncHistory: [expected],
        })
      );
      for (const selected of [result.record, await reopen()]) {
        expect(selected?.beds.R1.handoffNote).toBe(patient.handoffNote);
        expect(selected?.rayenSyncHistory).toEqual([expected]);
      }
    }
  );

  it.each(['local', 'remote', 'both'] as const)(
    'handles an absent %s history without losing the other source',
    async absent => {
      const localHistory = absent === 'local' || absent === 'both' ? undefined : [event()];
      const remoteHistory =
        absent === 'remote' || absent === 'both' ? undefined : [reviewedEvent()];
      await seed(record({ rayenSyncHistory: localHistory }));
      const result = await read(
        mode,
        record({ lastUpdated: laterTime, rayenSyncHistory: remoteHistory })
      );
      const expected = remoteHistory ?? localHistory ?? [];
      expect(result.record?.rayenSyncHistory ?? []).toEqual(expected);
      expect((await reopen())?.rayenSyncHistory ?? []).toEqual(expected);
    }
  );

  it('keeps a genuinely newer local terminal event over an older remote event', async () => {
    const terminal = event({ status: 'complete', completedAt: laterTime });
    await seed(record({ lastUpdated: laterTime, rayenSyncHistory: [terminal] }));

    const result = await read(mode, record({ rayenSyncHistory: [event({ status: 'applied' })] }));

    expect(result.record?.rayenSyncHistory).toEqual([terminal]);
    expect((await reopen())?.rayenSyncHistory).toEqual([terminal]);
  });

  it('preserves protected local narratives when remote text shrinks', async () => {
    const localPatient = DataFactory.createMockPatient('R1', {
      patientName: 'SYNTHETIC PATIENT',
      clinicalEpisodeId: 'synthetic-episode',
      admissionDate: date,
      pathology: 'Puérpera de cesárea.',
      handoffNote: 'SYNTHETIC LOCAL NARRATIVE WITH COMPLETE DETAILS',
    });
    await seed(record({ beds: { R1: localPatient } }));

    const result = await read(
      mode,
      record({
        lastUpdated: laterTime,
        beds: { R1: { ...localPatient, handoffNote: 'SHORT' } },
      })
    );
    const reloaded = await reopen();

    for (const selected of [result.record, reloaded]) {
      expect(selected?.beds.R1.handoffNote).toBe(localPatient.handoffNote);
    }
  });

  it('keeps the newer shorter remote canonical diagnosis', async () => {
    const localPatient = DataFactory.createMockPatient('R1', {
      patientName: 'SYNTHETIC PATIENT',
      clinicalEpisodeId: 'synthetic-episode',
      admissionDate: date,
      pathology: 'Puérpera de cesárea.',
    });
    await seed(record({ beds: { R1: localPatient } }));

    const result = await read(
      mode,
      record({
        lastUpdated: laterTime,
        beds: { R1: { ...localPatient, pathology: 'Puérpera' } },
      })
    );

    expect(result.record?.beds.R1.pathology).toBe('Puérpera');
    expect((await reopen())?.beds.R1.pathology).toBe('Puérpera');
  });

  it.each(unresolvedStates)(
    'retains the pending projection and outbox in state %s',
    async status => {
      const pending = record({ rayenSyncHistory: [event()], tensDayShift: ['SYNTHETIC PENDING'] });
      await seed(pending);
      await hospitalDB.syncQueue.add({
        opId: 'synthetic-pending-write',
        type: 'UPDATE_DAILY_RECORD',
        key: `daily:${date}`,
        payload: pending,
        timestamp: Date.parse(baseTime),
        retryCount: 0,
        status,
        syncContract: { expectedVersion: baseTime, changedPaths: ['tensDayShift'] },
      });
      const outboxBefore = await hospitalDB.syncQueue.toArray();

      const result = await read(
        mode,
        record({ lastUpdated: laterTime, rayenSyncHistory: [reviewedEvent()] })
      );

      for (const selected of [result.record, await reopen()]) {
        expect(selected?.tensDayShift).toEqual(['SYNTHETIC PENDING']);
        expect(selected?.rayenSyncHistory).toEqual(pending.rayenSyncHistory);
        expect(selected?.lastUpdated).toBe(baseTime);
      }
      expect(await hospitalDB.syncQueue.toArray()).toEqual(outboxBefore);
    }
  );
});

it('keeps original audit source records and arrays unchanged', async () => {
  await hospitalDB.open();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  const local = createLocalRuntimeReadCandidate(date, record({ rayenSyncHistory: [event()] }));
  const remote = record({ lastUpdated: laterTime, rayenSyncHistory: [reviewedEvent()] });
  const before = structuredClone([local.record, remote]);
  try {
    const result = await resolveRemoteGoldenPathReadResult({
      date,
      localCandidate: local,
      remoteReadResult: remoteLoad(remote),
      persistHydratedRecord: async value => value,
    });
    expect(result.record?.rayenSyncHistory).toEqual([reviewedEvent()]);
    expect([local.record, remote]).toEqual(before);
  } finally {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    hospitalDB.close();
  }
});
