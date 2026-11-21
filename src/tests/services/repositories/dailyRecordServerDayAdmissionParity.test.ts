import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, clone, day, harnessState } from '@/tests/services/storage/dayRecordOutboxHarness';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { migrateLegacyData } from '@/services/repositories/dataMigration';

const wire = vi.hoisted(() => ({
  emit: undefined as
    | undefined
    | ((
        record: DailyRecord | null,
        pending: boolean,
        metadata: { fromCache: boolean; hasPendingWrites: boolean }
      ) => void),
}));
// Only the listener's SDK delivery is substituted (with the same document conversion as the
// real listener); admission, preparation and Dexie are real.
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

/** A server day as an older client wrote it: the app prepares it before keeping a copy. */
const serverDay = (): DailyRecord => {
  const record = day(DATE, { R4: A('R4', { pathology: 'Diagnóstico sintético' }) });
  record.nursesDayShift = ['Enfermera sintética'];
  delete (record as Partial<DailyRecord>).schemaVersion;
  return record;
};

const asDelivered = (remote: DailyRecord) =>
  docToRecord(clone(remote) as unknown as Record<string, unknown>, DATE);

const storedAfterSubscription = async (remote: DailyRecord) => {
  let stop = () => {};
  await new Promise<void>(resolve => {
    stop = subscribeDetailed(DATE, () => resolve());
    wire.emit!(asDelivered(remote), false, { fromCache: false, hasPendingWrites: false });
  });
  stop();
  return hospitalDB.dailyRecords.get(DATE);
};

const storedAfterPointRead = async () => {
  await getForDateWithMeta(DATE, true);
  return hospitalDB.dailyRecords.get(DATE);
};

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-parity');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  h.offline = false;
});

afterEach(async () => {
  wire.emit = undefined;
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

it('keeps the same copy of a server day whether it arrives by the listener or by a point read', async () => {
  h.remote = serverDay();
  const byPointRead = await storedAfterPointRead();
  await hospitalDB.dailyRecords.clear();
  const bySubscription = await storedAfterSubscription(serverDay());

  expect(byPointRead).toBeDefined();
  expect(bySubscription).toEqual(byPointRead);
  // Kept as the server has it: the next edit's base values are the server's own (SAVE-02).
  expect(byPointRead).toEqual(migrateLegacyData(asDelivered(serverDay()), DATE));
});

it('a point read after the listener finds the copy already current and writes nothing', async () => {
  h.remote = serverDay();
  await storedAfterSubscription(serverDay());
  const put = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');

  await storedAfterPointRead();

  expect(put).not.toHaveBeenCalled();
});
