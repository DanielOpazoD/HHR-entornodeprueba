import { migrateLegacyData } from '@/services/repositories/dataMigration';
import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, B, clone, day, harnessState, writeNote } from './specialistHandoffOutboxHarness';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import {
  syncWithFirestoreDetailed,
  subscribeDetailed,
} from '@/services/repositories/dailyRecordRepositorySyncService';
import {
  createDailyRecordQueryOptions,
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';

const wire = vi.hoisted(() => ({
  emit: undefined as
    | undefined
    | ((
        record: DailyRecord,
        pending: boolean,
        metadata: { fromCache: boolean; hasPendingWrites: boolean }
      ) => void),
}));
// Only remote delivery is substituted; selectors, publication, outbox and Dexie are real.
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  getRecordsRangeFromFirestore: async () => [clone(harnessState().remote)],
  subscribeToRecord: (_date: string, callback: typeof wire.emit) => {
    wire.emit = callback;
    return () => {
      wire.emit = undefined;
    };
  },
}));

const DATE = '2026-10-24';
const NOTE = 'Nota especialista sintética pendiente';
const Q = 'Diagnóstico optimista sintético';
type Path = 'S' | 'E';
type Situation =
  | 'diaria'
  | 'especialista'
  | 'optimista'
  | 'local nueva'
  | 'otro paciente'
  | 'otro episodio'
  | 'limpia';
const h = harnessState();
let client: QueryClient;
const note = (record: DailyRecord | null | undefined) =>
  record?.beds.R4.medicalHandoffEntries?.[0]?.note;

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-admission');
  clearPendingDailyRecordPatchesForTests();
  resetMedicalHandoffDraftMemoryForTests();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  h.remote = null;
  h.offline = false;
  h.authorityMode = false;
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  client.clear();
  wire.emit = undefined;
  clearPendingDailyRecordPatchesForTests();
  resetMedicalHandoffDraftMemoryForTests();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

async function prepare(situation: Situation) {
  const base = day(DATE, {
    R4: A('R4', { pathology: 'Diagnóstico base', clinicalEpisodeId: 'ep_admission_a' }),
  });
  base.nursesDayShift = ['Local sintética'];
  await hospitalDB.dailyRecords.put(base);
  h.remote = clone(base);
  if (
    situation === 'especialista' ||
    situation === 'otro paciente' ||
    situation === 'otro episodio'
  ) {
    const result = await writeNote(base, 'R4', 'entry-A', NOTE);
    expect(result.result).toMatchObject({ queuedForRetry: true, updatedRemotely: false });
    expect(note(await hospitalDB.dailyRecords.get(DATE))).toBe(NOTE);
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      {
        type: 'UPDATE_SPECIALIST_HANDOFF',
        status: 'PENDING',
        key: expect.stringMatching(/^handoff:/),
      },
    ]);
  }
  if (situation === 'diaria') {
    const task: SyncTask = {
      opId: 'synthetic-admission-daily',
      key: `daily:${DATE}`,
      type: 'UPDATE_DAILY_RECORD',
      status: 'PENDING',
      payload: base,
      timestamp: 1,
      retryCount: 0,
    };
    await hospitalDB.syncQueue.add(task);
  }
  if (situation === 'optimista' || situation === 'otro paciente' || situation === 'otro episodio') {
    registerPendingDailyRecordPatch(DATE, { 'beds.R4.pathology': Q });
  }
  if (situation === 'local nueva') {
    await hospitalDB.dailyRecords.put({ ...base, lastUpdated: '2026-10-24T14:00:00.000Z' });
  }
  const remote = {
    ...clone(base),
    nursesDayShift: ['Remota sintética'],
    lastUpdated: '2026-10-24T11:00:00.000Z',
  };
  if (situation === 'otro paciente') remote.beds.R4 = B();
  if (situation === 'otro episodio')
    remote.beds.R4 = A('R4', {
      clinicalEpisodeId: 'ep_admission_reentry',
      admissionDate: '2026-10-23',
      pathology: 'Nuevo episodio',
    });
  h.remote = remote;
  const local = await hospitalDB.dailyRecords.get(DATE);
  if (!local) throw new Error('Missing synthetic local row');
  setDailyRecordQueryData(client, DATE, local);
  return { local, remote, tasks: await hospitalDB.syncQueue.toArray() };
}

import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import * as freshness from '@/hooks/controllers/dailyRecordFreshnessGateController';
import * as confirmation from '@/hooks/controllers/dailyRecordRemoteConfirmationController';
import * as confirmedCache from '@/hooks/controllers/dailyRecordConfirmedCacheController';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

async function read(path: Path, remote: DailyRecord): Promise<SyncDailyRecordResult> {
  if (path === 'E') {
    const result = await syncWithFirestoreDetailed(DATE);
    if (!result) throw new Error('Missing result');
    return result;
  }
  return new Promise((resolve, reject) => {
    const stop = subscribeDetailed(
      DATE,
      result => {
        stop();
        resolve(result);
      },
      () => reject(new Error('Subscription failed'))
    );
    wire.emit!(clone(remote), false, { fromCache: false, hasPendingWrites: false });
  });
}
for (const path of ['S', 'E'] as const) {
  for (const scenario of ['especialista', 'limpia', 'incompatible'] as const) {
    it(`public ${path} stabilizes first admission: ${scenario}`, async () => {
      const { remote } = await prepare(scenario === 'limpia' ? 'limpia' : 'especialista');
      if (scenario === 'incompatible') {
        remote.beds.R4 = B();
        // A stored row already in the stable remote shape needs no admission write.
        Object.assign(
          remote,
          prepareDailyRecordForPersistence(
            resolveDailyRecordConflict(
              migrateLegacyData(remote, DATE),
              migrateLegacyData(remote, DATE)
            ),
            DATE
          )
        );
        remote.tensDayShift = ['', '', ''];
        remote.tensNightShift = ['', '', ''];
        await hospitalDB.dailyRecords.put(clone(remote));
      }
      h.remote = remote;
      const tasks = await hospitalDB.syncQueue.toArray();
      const put = vi.spyOn(hospitalDB.dailyRecords, 'put');
      const bulk = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
      const event = vi.fn();
      const writes: number[] = [];
      const events: number[] = [];
      window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
      try {
        for (let i = 0; i < 5; i++) {
          put.mockClear();
          bulk.mockClear();
          event.mockClear();
          const result = await read(path, remote);
          expect(note(result.record) ?? '').toBe(scenario === 'especialista' ? NOTE : '');
          expect(result.record).toEqual(await hospitalDB.dailyRecords.get(DATE));
          writes.push(put.mock.calls.length + bulk.mock.calls.length);
          events.push(event.mock.calls.length);
        }
      } finally {
        window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
      }
      const expected = scenario === 'incompatible' ? [0, 0, 0, 0, 0] : [1, 0, 0, 0, 0];
      expect(writes).toEqual(expected);
      expect(events).toEqual(expected);
      expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
    });
  }
  it(`public ${path} retains daily-holder observation semantics`, async () => {
    const { remote } = await prepare('diaria');
    expect(await read(path, remote)).toMatchObject({
      serverConfirmed: true,
      sourceOfTruth: 'local',
      consistencyState: 'local_kept',
    });
  });
  it(`public ${path} publication never confirms the projected note`, async () => {
    const { remote } = await prepare('especialista');
    freshness.resetDailyRecordFreshnessGateForTests();
    freshness.markDailyRecordRemoteConfirmed(DATE, {
      source: 'query',
      confirmedRecord: clone(remote),
    });
    const mark = vi.spyOn(freshness, 'markDailyRecordRemoteConfirmed');
    const apply = vi.spyOn(confirmation, 'applyDailyRecordRemoteConfirmation');
    const cache = vi.spyOn(confirmedCache, 'setRemoteConfirmedDailyRecordQueryData');
    if (path === 'E') {
      const result = await read(path, remote);
      expect(result).toMatchObject({
        serverConfirmed: true,
        sourceOfTruth: 'local',
        consistencyState: 'local_kept',
      });
      await client.fetchQuery(createDailyRecordQueryOptions({ getForDateWithMeta }, DATE, client));
    } else {
      const stop = createDailyRecordSubscription(
        { getForDateWithMeta, subscribeDetailed },
        DATE,
        client
      );
      try {
        wire.emit!(clone(remote), false, { fromCache: false, hasPendingWrites: false });
        await vi.waitFor(() => expect(mark).toHaveBeenCalled());
      } finally {
        stop();
      }
    }
    const displayed = client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(DATE));
    expect(note(displayed?.record)).toBe(NOTE);
    expect(displayed?.runtime).toMatchObject({
      serverConfirmed: true,
      sourceOfTruth: 'local',
      consistencyState: path === 'E' ? 'repaired_local' : 'local_kept',
    });
    expect(mark).toHaveBeenCalled();
    for (const [, params] of mark.mock.calls) {
      expect(params).not.toHaveProperty('confirmedRecord');
      expect(params).not.toHaveProperty('remoteLastUpdated');
    }
    expect(cache).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalled();
    for (const [state] of apply.mock.calls) {
      expect(state.lastConfirmedRecord).toEqual(remote);
      expect(JSON.stringify(state.lastConfirmedRecord)).not.toContain(NOTE);
    }
    expect(note(remote)).toBe('');
  });
}
