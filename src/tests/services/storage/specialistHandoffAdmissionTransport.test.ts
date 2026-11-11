import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, clone, day, harnessState } from './specialistHandoffOutboxHarness';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  syncWithFirestoreDetailed,
  subscribeDetailed,
} from '@/services/repositories/dailyRecordRepositorySyncService';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';
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
type Path = 'S' | 'E';
const h = harnessState();
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
});
afterEach(async () => {
  wire.emit = undefined;
  clearPendingDailyRecordPatchesForTests();
  resetMedicalHandoffDraftMemoryForTests();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function prepareRemote() {
  const base = day(DATE, {
    R4: A('R4', { pathology: 'Diagnóstico base', clinicalEpisodeId: 'ep_admission_a' }),
  });
  base.nursesDayShift = ['Remota sintética'];
  return prepareDailyRecordForPersistence(migrateLegacyData(base, DATE), DATE);
}

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

import { migrateLegacyData } from '@/services/repositories/dataMigration';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import * as firebase from 'firebase/firestore';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { runRemoteSaveIntegrityCheck } from '@/services/repositories/dailyRecordRemoteWriteController';
import { resolveBlockingFieldShrinkages } from '@/services/repositories/dailyRecordFieldShrinkageGuard';

for (const path of ['S', 'E'] as const) {
  for (const reads of [1, 2]) {
    it(`transport after ${reads} public ${path} reads sends only existing root fields`, async () => {
      // A complete server row isolates admission from legacy schema migration defaults.
      const remote = prepareRemote();
      h.remote = clone(remote);
      await hospitalDB.dailyRecords.clear();
      for (let i = 0; i < reads; i++) await read(path, remote);
      const base = await hospitalDB.dailyRecords.get(DATE);
      if (!base) throw new Error('Missing admitted row');
      await runRemoteSaveIntegrityCheck(DATE, base);
      expect(
        await resolveBlockingFieldShrinkages(DATE, base, { 'beds.R4.pathology': 'Dx' })
      ).toEqual([]);
      h.offline = true;
      await updatePartialDetailed(
        DATE,
        { 'beds.R4.pathology': 'Diagnóstico editado sintético' },
        { baseRecord: base }
      );
      h.offline = false;
      const tasks = await hospitalDB.syncQueue.toArray();
      expect(tasks).toHaveLength(1);
      const task = tasks[0];
      if (!task) throw new Error('Missing daily task');
      expect(task.syncContract?.changedPaths).toEqual(['beds.R4.pathology']);
      const writes: object[] = [];
      vi.mocked(firebase.runTransaction).mockImplementation(async (_db, run) =>
        run({
          get: async () => ({ exists: () => true, data: () => clone(remote) }),
          set: (_ref: unknown, data: object) => {
            writes.push(clone(data));
          },
        } as never)
      );
      await createFirestoreSyncTransport().run(task);
      expect(writes).toHaveLength(1);
      expect(writes[0]).not.toHaveProperty('rayenSyncHistory');
      expect(writes[0]).not.toHaveProperty('rayenBedCollisionResolutions');
      expect(Object.keys(writes[0] ?? {}).sort()).toEqual(
        [...new Set([...Object.keys(remote), 'beds'])].sort()
      );
    });
  }
}
