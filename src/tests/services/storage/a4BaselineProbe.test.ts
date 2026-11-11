import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  A,
  clone,
  day,
  harnessState,
  writeNote,
  createServerHandler,
  reconnect,
} from './specialistHandoffOutboxHarness';
import { readMedicalHandoffDrafts } from '@/services/storage/medicalHandoffDraftStorage';
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
const NOTE = 'Nota especialista sintética pendiente';
const h = harnessState();
const fields = [
  'handoffNote',
  'handoffNoteDayShift',
  'handoffNoteNightShift',
  'medicalHandoffNote',
] as const;
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
  for (const nextNote of ['Texto confirmado posterior', '']) {
    it(`${path} adopts a newer ${nextNote ? 'shorter' : 'empty'} colleague note after ACK`, async () => {
      const base = day(DATE, { R4: A() });
      await hospitalDB.dailyRecords.put(base);
      h.remote = clone(base);
      await writeNote(base, 'R4', 'entry-A', NOTE);
      h.handler = createServerHandler();
      await reconnect();
      expect(await hospitalDB.syncQueue.count()).toBe(0);
      const confirmed = await hospitalDB.dailyRecords.get(DATE);
      if (!confirmed) throw new Error('Missing confirmed row');
      expect(confirmed.beds.R4.medicalHandoffEntries?.[0].note).toBe(NOTE);
      for (const field of fields) confirmed.beds.R4[field] = NOTE;
      await hospitalDB.dailyRecords.put(confirmed);
      const remote = clone(confirmed);
      remote.lastUpdated = '2026-10-24T16:00:00.000Z';
      for (const field of fields) remote.beds.R4[field] = nextNote;
      const entry = remote.beds.R4.medicalHandoffEntries?.[0];
      if (!entry) throw new Error('Missing entry');
      entry.note = nextNote;
      const result = await read(path, remote);
      const stored = await hospitalDB.dailyRecords.get(DATE);
      for (const row of [result.record, stored]) {
        expect.soft(row?.beds.R4.medicalHandoffEntries?.[0].note).toBe(nextNote);
        for (const field of fields) expect.soft(row?.beds.R4[field]).toBe(nextNote);
      }
      expect(await hospitalDB.syncQueue.count()).toBe(0);
    });
  }
}

for (const path of ['S', 'E'] as const) {
  it(`${path} detaches an unsent specialist note when a colleague changed its base`, async () => {
    const base = day(DATE, { R4: A() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeNote(base, 'R4', 'entry-A', NOTE);
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toMatchObject([{ type: 'UPDATE_SPECIALIST_HANDOFF', status: 'PENDING' }]);
    const local = await hospitalDB.dailyRecords.get(DATE);
    if (!local) throw new Error('Missing pending row');
    local.lastUpdated = '2026-10-24T11:00:00.000Z';
    await hospitalDB.dailyRecords.put(local);
    const remote = clone(local);
    remote.lastUpdated = '2026-10-24T16:00:00.000Z';
    remote.beds.R4.medicalHandoffNote = 'Texto confirmado posterior';
    const entry = remote.beds.R4.medicalHandoffEntries?.[0];
    if (!entry) throw new Error('Missing entry');
    entry.note = 'Texto confirmado posterior';
    const result = await read(path, remote);
    const stored = await hospitalDB.dailyRecords.get(DATE);
    for (const row of [result.record, stored]) {
      expect.soft(row?.beds.R4.medicalHandoffEntries?.[0].note).toBe('Texto confirmado posterior');
      expect.soft(row?.beds.R4.medicalHandoffNote).toBe('Texto confirmado posterior');
    }
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
    expect(readMedicalHandoffDrafts().some(draft => draft.value === NOTE)).toBe(true);
  });
}

for (const path of ['S', 'E'] as const) {
  it(`${path} projects only a compatible pending note and preserves remote metadata`, async () => {
    const base = day(DATE, { R4: A() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeNote(base, 'R4', 'entry-A', NOTE);
    const tasks = await hospitalDB.syncQueue.toArray();
    const remote = clone(base);
    remote.lastUpdated = '2026-10-24T16:00:00.000Z';
    const result = await read(path, remote);
    expect(result.record?.beds.R4.medicalHandoffEntries?.[0].note).toBe(NOTE);
    expect(result.record?.lastUpdated).toBe(remote.lastUpdated);
    expect(result.sourceOfTruth).toBe('local');
    expect(result.serverConfirmed).toBe(true);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(result.record);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
  });

  it(`${path} records an unheld newer row replacement without copying it and repeats without writes or events`, async () => {
    const remote = day(DATE, { R4: A() });
    const local = clone(remote);
    local.lastUpdated = '2026-10-24T23:00:00.000Z';
    local.beds.R4.medicalHandoffNote = 'Única copia sintética local';
    await hospitalDB.settings.clear();
    await hospitalDB.dailyRecords.put(local);
    const result = await read(path, remote);
    expect(result.record?.lastUpdated).toBe(remote.lastUpdated);
    expect(result.record?.beds.R4.medicalHandoffNote).toBe(remote.beds.R4.medicalHandoffNote);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(result.record);
    const copies = await hospitalDB.settings
      .where('id')
      .startsWith('remote-admission-recovery:')
      .toArray();
    expect(copies).toEqual([]);
    const put = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
    const second = await read(path, remote);
    expect(second.record).toEqual(result.record);
    expect(put).not.toHaveBeenCalled();
    expect(
      await hospitalDB.settings.where('id').startsWith('remote-admission-recovery:').count()
    ).toBe(0);
  });
}

it('D1 replacement rolls back atomically if the daily write fails', async () => {
  const remote = day(DATE, { R4: A() });
  const local = { ...clone(remote), lastUpdated: '2026-10-24T23:00:00.000Z' };
  await hospitalDB.dailyRecords.put(local);
  vi.spyOn(hospitalDB.dailyRecords, 'bulkPut').mockRejectedValueOnce(
    new Error('Synthetic write failure')
  );
  const { admitRemoteDailyRecords } =
    await import('@/services/repositories/dailyRecordLocalCachePersistence');
  await expect(
    admitRemoteDailyRecords([{ record: remote, remoteRecord: remote }])
  ).rejects.toThrow();
  expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(local);
});

it('D1 emits one content-free occurrence only for a newer unheld local row after commit', async () => {
  const telemetry = vi.spyOn(
    await import('@/services/observability/operationalTelemetryRecorder'),
    'recordOperationalTelemetry'
  );
  const { admitRemoteDailyRecords } =
    await import('@/services/repositories/dailyRecordLocalCachePersistence');
  const remote = day(DATE, { R4: A() });
  const local = { ...clone(remote), lastUpdated: '2026-10-24T23:00:00.000Z' };
  await hospitalDB.settings.clear();
  await hospitalDB.dailyRecords.put(local);
  const Dexie = (await import('dexie')).default;
  const { parseOperationalTelemetryBody } =
    await import('@/services/observability/operationalTelemetryIngestPolicy');
  telemetry.mockImplementation(event => {
    if (event.context?.reason === 'unheld_newer_local_replaced') {
      expect(Dexie.currentTransaction).toBeFalsy();
      const parsed = parseOperationalTelemetryBody(
        JSON.stringify({
          source: 'hhr_operational_telemetry',
          event: { ...event, timestamp: '2026-10-24T16:00:00.000Z' },
        })
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.event.operation).toBe('indexeddb_save_records');
        expect(parsed.event.context).toEqual({ reason: 'unheld_newer_local_replaced', count: 1 });
      }
    }
  });
  await admitRemoteDailyRecords([{ record: remote, remoteRecord: remote }]);
  expect(telemetry).toHaveBeenCalledExactlyOnceWith({
    category: 'indexeddb',
    operation: 'indexeddb_save_records',
    status: 'degraded',
    context: { reason: 'unheld_newer_local_replaced', count: 1 },
  });
  expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(remote);
  expect(await hospitalDB.settings.toArray()).toEqual([]);
  telemetry.mockClear();
  for (let i = 0; i < 30; i++) {
    remote.lastUpdated = new Date(Date.parse(remote.lastUpdated) + 60000).toISOString();
    remote.beds.R4.pathology = `Server synthetic ${i}`;
    await admitRemoteDailyRecords([{ record: clone(remote), remoteRecord: clone(remote) }]);
  }
  for (let i = 0; i < 30; i++) {
    remote.lastUpdated = new Date(Date.parse(remote.lastUpdated) + 60000).toISOString();
    await admitRemoteDailyRecords([{ record: clone(remote), remoteRecord: clone(remote) }]);
  }
  await admitRemoteDailyRecords([{ record: remote, remoteRecord: remote }]);
  expect(telemetry).not.toHaveBeenCalled();
  expect(await hospitalDB.settings.toArray()).toEqual([]);
  const { clearSessionDailyRecords } =
    await import('@/services/storage/sessionSyncQueuePreservation');
  await clearSessionDailyRecords('user:synthetic-admission');
  hospitalDB.close();
  await hospitalDB.open();
  expect(await hospitalDB.dailyRecords.count()).toBe(0);
  expect(await hospitalDB.settings.toArray()).toEqual([]);
});
