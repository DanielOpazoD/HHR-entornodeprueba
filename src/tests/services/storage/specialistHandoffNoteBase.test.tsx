/**
 * Synthetic-only: a queued specialist note never replaces a note saved after its edit began.
 * Real write service, queue, transport and callable handler; only Firestore and the SDKs are fake.
 */
import 'fake-indexeddb/auto';
import {
  A,
  clone,
  createServerHandler,
  day,
  draftsFor,
  harnessState,
  reconnect,
  writeNote,
} from './specialistHandoffOutboxHarness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const h = harnessState();
const DATE = '2026-10-24';
const remoteNote = () => (h.remote as DailyRecord).beds.R4.medicalHandoffEntries?.[0]?.note;
const queue = () => hospitalDB.syncQueue.toArray();
/** Another writer saves a later note for the same patient. */
const colleagueWrites = (note: string, { stampsMeta }: { stampsMeta: boolean }) => {
  const remote = h.remote as DailyRecord;
  remote.beds.R4.medicalHandoffEntries = [{ ...remote.beds.R4.medicalHandoffEntries![0], note }];
  remote.beds.R4.medicalHandoffNote = note;
  remote.lastUpdated = '2026-10-24T13:00:00.000Z';
  if (stampsMeta)
    (remote as DailyRecord & { meta?: object }).meta = {
      lastMutationId: 'synthetic-colleague-write',
      lastChangedPaths: ['beds.R4.medicalHandoffEntries', 'beds.R4.medicalHandoffNote'],
    };
};
const reopen = async () => {
  hospitalDB.close();
  await hospitalDB.open();
  resetMedicalHandoffDraftMemoryForTests();
};
const start = async () => {
  const base = day(DATE, { R4: A() });
  h.remote = clone(base);
  await hospitalDB.dailyRecords.put(base);
  return base;
};

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  resetMedicalHandoffDraftMemoryForTests();
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-note-base');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  h.handler = createServerHandler();
  h.role = 'admin';
  h.offline = false;
  h.loseNextResponse = false;
});
afterEach(() => {
  h.loseNextResponse = false;
});

describe('a queued specialist note keeps a later note', () => {
  it('never writes an offline note over a colleague note saved after the edit began', async () => {
    const base = await start();
    await writeNote(base, 'R4', 'entry-A', 'Nota antigua sin conexión');
    colleagueWrites('Nota nueva de un colega', { stampsMeta: true });

    await reconnect();

    expect(remoteNote()).toBe('Nota nueva de un colega');
    expect(await queue()).toEqual([
      expect.objectContaining({ type: 'UPDATE_SPECIALIST_HANDOFF', status: 'CONFLICT' }),
    ]);
    expect(draftsFor('Paciente A Sintético')).toEqual([
      [DATE, 'entry-A', 'Nota antigua sin conexión'],
    ]);
  });

  it('never replays a note whose answer was lost over a later colleague note', async () => {
    const base = await start();
    h.loseNextResponse = true;
    const saved = await writeNote(base, 'R4', 'entry-A', 'Nota de A publicada', {
      offline: false,
    });
    expect(saved.result).toMatchObject({ queuedForRetry: true });
    colleagueWrites('Nota posterior de un colega', { stampsMeta: true });

    await reopen();
    await reconnect();

    expect(remoteNote()).toBe('Nota posterior de un colega');
    expect(await queue()).toEqual([expect.objectContaining({ status: 'CONFLICT' })]);
  });

  it('acknowledges a lost answer once the record still shows that write was the last one', async () => {
    const base = await start();
    h.loseNextResponse = true;
    await writeNote(base, 'R4', 'entry-A', 'Nota de A publicada', { offline: false });
    // A direct write records no write id, so the specialist write is still the last one known.
    colleagueWrites('Nota posterior de un colega', { stampsMeta: false });

    await reopen();
    await reconnect();

    expect(remoteNote()).toBe('Nota posterior de un colega');
    expect(await queue()).toEqual([]);
  });

  it('folds a later offline edit into a note whose answer was lost and publishes the latest text', async () => {
    const base = await start();
    h.loseNextResponse = true;
    const first = await writeNote(base, 'R4', 'entry-A', 'Primera versión', { offline: false });
    await writeNote(first.record, 'R4', 'entry-A', 'Segunda versión');
    expect(await queue()).toHaveLength(1);

    await reconnect();

    expect(remoteNote()).toBe('Segunda versión');
    expect(await queue()).toEqual([]);
  });
});
