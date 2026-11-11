import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, clone, day, harnessState } from './specialistHandoffOutboxHarness';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  subscribeDetailed,
  syncWithFirestoreDetailed,
} from '@/services/repositories/dailyRecordRepositorySyncService';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const wire = vi.hoisted(() => ({
  emit: undefined as
    | undefined
    | ((
        record: DailyRecord,
        pending: boolean,
        metadata: { fromCache: boolean; hasPendingWrites: boolean }
      ) => void),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: (_date: string, callback: typeof wire.emit) => {
    wire.emit = callback;
    return () => {
      wire.emit = undefined;
    };
  },
}));
const DATE = '2026-10-24';
const h = harnessState();
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-newer-note');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  h.remote = null;
  h.offline = false;
  h.authorityMode = false;
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
});
afterEach(async () => {
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
  sessionStorage.clear();
  wire.emit = undefined;
  vi.restoreAllMocks();
});
async function read(path: 'S' | 'E', remote: DailyRecord): Promise<SyncDailyRecordResult> {
  h.remote = clone(remote);
  if (path === 'E') {
    const result = await syncWithFirestoreDetailed(DATE);
    if (!result) throw new Error('Missing explicit read');
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
    if (!wire.emit) throw new Error('Missing subscription');
    wire.emit(clone(remote), false, { fromCache: false, hasPendingWrites: false });
  });
}
for (const path of ['S', 'E'] as const) {
  for (const status of ['FAILED', 'CONFLICT'] as const) {
    it(`${path} leaves a quarantined daily task unchanged when its local copy is absent (${status})`, async () => {
      const remote = day(DATE, { R4: A() });
      const payload = clone(remote);
      payload.beds.R4.pathology = 'Edición sintética pendiente conservada en payload';
      await hospitalDB.syncQueue.add({
        opId: 'synthetic-legacy-orphan',
        type: 'UPDATE_DAILY_RECORD',
        key: `daily:${DATE}`,
        payload,
        status,
        timestamp: 1,
        retryCount: 1,
        ownerKey: 'user:synthetic-newer-note',
      });
      expect(await hospitalDB.dailyRecords.get(DATE)).toBeUndefined();
      const before = await hospitalDB.syncQueue.toArray();
      const result = await read(path, remote);
      const after = await hospitalDB.syncQueue.toArray();
      console.log(
        JSON.stringify({
          path,
          status,
          serverConfirmed: result.serverConfirmed,
          queueCountBefore: before.length,
          queueCountAfter: after.length,
          projectionReleasedBefore: before[0]?.projectionReleased ?? false,
          projectionReleasedAfter: after[0]?.projectionReleased ?? false,
          payloadPreserved:
            JSON.stringify(before[0]?.payload) === JSON.stringify(after[0]?.payload),
        })
      );
      expect(after).toEqual(before.map(task => ({ ...task, projectionReleased: true })));
    });
  }
}
