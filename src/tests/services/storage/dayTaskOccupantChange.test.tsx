import { captureAuthoringSession } from '@/services/storage/authoringSession';
/**
 * Synthetic-only: a census edit queued offline while another session replaces the bed's patient,
 * the crib's newborn or the mother. Real write service, queue engine, transport and clinical
 * authority handler; only Firestore, Functions and the network state are faked. A slot holding
 * another patient is never written from the stale copy, and the departed patient's edits stay
 * durable as their own conflict.
 */
import 'fake-indexeddb/auto';
import { A, B, E, clone, day, harnessState, patient, reconnect } from './dayRecordOutboxHarness';
import {
  B_AT,
  DATE,
  MODES,
  dayTasks,
  expectBInR4,
  expectDayEditsPublishedOrKept,
  local,
  queue,
  readStored,
  remote,
  remoteWrite,
  resetDay,
  saveWholeDay,
  writeDay,
} from './dayRecordDaySupport';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { listRecentSyncQueueOperations, retryQuarantinedSyncTask } from '@/services/storage/sync';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import type { SyncQueueStats } from '@/hooks/useSyncQueueMonitor';
import type { DailyRecord, DailyRecordPatch } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const h = harnessState();
const OWNER = 'user:synthetic-occupant-change';

/** A census edit, offline, on the device's own clock. */
const writeDayNow = async (record: DailyRecord, patch: Record<string, unknown>) => {
  h.offline = true;
  try {
    return await updatePartialDetailed(DATE, patch as DailyRecordPatch, {
      authoringSession: captureAuthoringSession(),
      baseRecord: record,
    });
  } finally {
    h.offline = false;
  }
};
/** A retry also starts a background run; reconnect until no task is waiting or in flight. */
const settleQueue = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await reconnect();
    const tasks = await queue();
    if (!tasks.some(task => task.status === 'PENDING' || task.status === 'PROCESSING')) return;
  }
};

const F = (extra: Partial<PatientData> = {}) =>
  patient('R7', 'Paciente F Sintético', {
    rut: '55.555.555-5',
    clinicalEpisodeId: 'ep-F',
    pathology: 'Dx F',
    ...extra,
  });
const newborn = (name: string, episode: string, rut: string) =>
  patient('R4', name, { rut, clinicalEpisodeId: episode });
const mother = (
  crib: PatientData,
  name = 'Madre M Sintética',
  episode = 'ep-M',
  rut = '33.333.333-3'
) =>
  patient('R4', name, {
    rut,
    clinicalEpisodeId: episode,
    // Days written before the old medical handoff was retired still carry its entries.
    medicalHandoffEntries: [{ id: 'entry-M', specialty: 'Medicina Interna', note: '' }],
    clinicalCrib: crib,
  } as Partial<PatientData>);
const RN_A = () => newborn('RN A Sintético', 'ep-RNA', '44.444.444-4');
const RN_B = () => newborn('RN B Sintético', 'ep-RNB', '22.222.222-2');

beforeEach(async () => {
  await resetDay(OWNER);
  h.beforeDayTransaction = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('a day task never writes a patient edits to the next occupant', () => {
  it('rebuilds the held edits when the authority already published the task and its ACK rolled back', async () => {
    const base = day(DATE, { R4: A('R4', { pathology: 'Dx A' }), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeDayNow(base, {
      'beds.R4.pathology': 'Dx A pendiente',
      'beds.R6.pathology': 'Dx E corregido',
    });
    // Same version on the server, another patient in R4: the authority accepts the base.
    h.remote = day(DATE, { R4: B(), R6: E() }, base.lastUpdated);
    h.authorityMode = true;
    const store = createDexieSyncQueueStore();
    const transport = createFirestoreSyncTransport();
    const now = Date.now() + 60 * 60 * 1000;
    const claim = { leaseOwner: 'synthetic-lease', leaseUntil: now + 60_000, attemptId: 'try-1' };
    const [task] = await store.claimReadyPending(now, 25, OWNER, claim);
    const first = await transport.run(task);
    expect(first?.detachedConflicts).toHaveLength(1);
    vi.spyOn(hospitalDB.syncQueue, 'delete').mockRejectedValueOnce(
      new DOMException('Synthetic failure after the conflict insert', 'QuotaExceededError')
    );
    await expect(
      store.deleteClaimed(task.id!, claim, first?.authoritativeRecord, first?.detachedConflicts)
    ).rejects.toThrow();
    expect(await queue()).toEqual([expect.objectContaining({ id: task.id })]);

    const replay = await transport.run(task);
    await store.deleteClaimed(
      task.id!,
      claim,
      replay?.authoritativeRecord,
      replay?.detachedConflicts
    );

    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    expect(remote().beds.R4).toMatchObject({ patientName: 'Paciente B Sintético' });
    const [held, ...rest] = await queue();
    expect(rest).toEqual([]);
    expect(held).toMatchObject({ status: 'CONFLICT', lastErrorCode: 'occupant_changed' });
    expect((held.payload as DailyRecord).beds.R4).toMatchObject({
      clinicalEpisodeId: 'ep-A',
      pathology: 'Dx A pendiente',
    });
  });

  it('detaches the edits written for A as one conflict, while another bed syncs', async () => {
    const base = day(DATE, { R4: A('R4', { pathology: 'Dx A' }), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeDayNow(base, { 'beds.R4.pathology': 'Dx A corregido' });
    await writeDayNow(await local(), { 'beds.R4.diagnosisComments': 'Comentario de A' });
    await writeDayNow(await local(), { 'beds.R6.pathology': 'Dx E corregido' });

    h.remote = day(
      DATE,
      { R4: { ...B(), pathology: 'Dx B' }, R6: E() },
      '2026-10-24T11:00:00.000Z'
    );
    await reconnect();

    expect(remote().beds.R4).toMatchObject({
      patientName: 'Paciente B Sintético',
      pathology: 'Dx B',
    });
    expect(JSON.stringify(remote().beds.R4)).not.toContain('Comentario de A');
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    const [conflict, ...rest] = await queue();
    expect(rest).toEqual([]);
    expect(conflict).toMatchObject({ status: 'CONFLICT', type: 'UPDATE_DAILY_RECORD' });
    expect(conflict.key).toContain(':detached:');
    expect(conflict.syncContract?.changedPaths).toEqual(
      expect.arrayContaining(['beds.R4.pathology', 'beds.R4.diagnosisComments'])
    );
    expect((conflict.payload as DailyRecord).beds.R4).toMatchObject({
      clinicalEpisodeId: 'ep-A',
      pathology: 'Dx A corregido',
      diagnosisComments: 'Comentario de A',
    });
    expect((await local()).beds.R4.patientName).toBe('Paciente B Sintético');

    const operations = await listRecentSyncQueueOperations(10);
    const stats = {
      pending: 0,
      failed: 0,
      conflict: 1,
      retrying: 0,
      readState: 'ok',
    } as SyncQueueStats;
    render(
      <RayenSyncQueueDetails
        stats={stats}
        operations={operations}
        refresh={vi.fn(async () => {})}
        working={false}
      />
    );
    expect(screen.getByText('Cambios de Paciente A Sintético · 24-10-2026')).toBeInTheDocument();
    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument();
  });

  it('keeps a retried held conflict while A is gone, and publishes it once A and the episode are back', async () => {
    const base = day(DATE, { R4: A('R4', { pathology: 'Dx A' }), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeDayNow(base, { 'beds.R4.pathology': 'Dx A corregido' });
    await writeDayNow(await local(), { 'beds.R6.pathology': 'Dx E corregido' });
    h.remote = day(
      DATE,
      { R4: { ...B(), pathology: 'Dx B' }, R6: E() },
      '2026-10-24T11:00:00.000Z'
    );
    await reconnect();
    const [held] = await queue();

    expect(await retryQuarantinedSyncTask(held.id!)).toBe(true);
    await settleQueue();
    expect(await queue()).toEqual([
      expect.objectContaining({ id: held.id, key: held.key, status: 'CONFLICT' }),
    ]);
    expect(remote().beds.R4).toMatchObject({
      patientName: 'Paciente B Sintético',
      pathology: 'Dx B',
    });

    // Another device undoes the move: A is back in R4 with the same episode.
    h.remote = day(
      DATE,
      { R4: A('R4', { pathology: 'Dx A' }), R6: E({ pathology: 'Dx E corregido' }) },
      '2026-10-24T12:00:00.000Z'
    );
    expect(await retryQuarantinedSyncTask(held.id!)).toBe(true);
    await settleQueue();
    expect(remote().beds.R4).toMatchObject({
      clinicalEpisodeId: 'ep-A',
      pathology: 'Dx A corregido',
    });
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    expect(await queue()).toEqual([]);
    expect((await local()).beds.R4.pathology).toBe('Dx A corregido');
  });
});

describe.each(MODES)(
  'a census edit queued while another session replaces a patient (%s)',
  (_mode, enforced) => {
    const replay = async () => {
      h.authorityMode = enforced;
      await reconnect();
    };

    it('publishes or keeps an edit of another bed, and keeps B', async () => {
      const read = await readStored({ R4: A('R4'), R6: E() });
      await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
      expect((await dayTasks()).map(task => task.syncContract?.expectedVersion)).toEqual([
        read.lastUpdated,
      ]);
      h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);

      await replay();

      expectBInR4();
      await expectDayEditsPublishedOrKept(enforced, { 'beds.R6.pathology': 'Dx E corregido' });
    });

    it('keeps an edit of the departed patient, not written on B, when it edits the same bed', async () => {
      await readStored({ R4: A('R4', { pathology: 'Dx A' }), R6: E() });
      await writeDay({
        'beds.R4.pathology': 'Dx A corregido',
        'beds.R6.pathology': 'Dx E corregido',
      });
      h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);

      await replay();

      expectBInR4();
      expect(remote().beds.R4.pathology).not.toBe('Dx A corregido');
      // client_only holds the departed patient's edit as its own conflict and publishes the rest;
      // enforced keeps the whole day write queued.
      await expectDayEditsPublishedOrKept(enforced, { 'beds.R6.pathology': 'Dx E corregido' });
      const kept = (await queue()).filter(task => task.type === 'UPDATE_DAILY_RECORD');
      expect(kept.map(task => (task.payload as DailyRecord).beds.R4.pathology)).toEqual([
        'Dx A corregido',
      ]);
    });

    it('publishes several census edits of other beds', async () => {
      await readStored({ R4: A('R4'), R6: E(), R7: F() });
      await writeDay({ 'beds.R6.pathology': 'Dx E v1' }, '2026-10-24T10:40:00.000Z');
      await writeDay({ 'beds.R7.pathology': 'Dx F corregido' }, '2026-10-24T10:42:00.000Z');
      await writeDay({ 'beds.R6.pathology': 'Dx E v2' }, '2026-10-24T10:44:00.000Z');
      h.remote = day(DATE, { R4: B(), R6: E(), R7: F() }, B_AT);

      await replay();

      expectBInR4();
      await expectDayEditsPublishedOrKept(enforced, {
        'beds.R6.pathology': 'Dx E v2',
        'beds.R7.pathology': 'Dx F corregido',
      });
    });

    it('never writes a departed newborn over the crib while it edits the mother', async () => {
      await readStored({ R4: mother(RN_A()), R6: E() });
      await writeDay({ 'beds.R4.pathology': 'Dx M corregido' });
      // A session with a slow clock: its write looks older than this device's read.
      remoteWrite({ R4: mother(RN_B()), R6: E() }, '2026-10-24T09:50:00.000Z');

      await replay();

      expect(remote().beds.R4.clinicalCrib).toMatchObject({ patientName: 'RN B Sintético' });
      // An older remote clock does not prove the queued base is current. Authority keeps this
      // mismatch for review, with the mother's edit intact and the new newborn untouched.
      await expectDayEditsPublishedOrKept(enforced, { 'beds.R4.pathology': 'Dx M corregido' });
    });

    it('never writes a departed mother over the bed while it edits the newborn', async () => {
      await readStored({ R4: mother(RN_A()), R6: E() });
      await writeDay({ 'beds.R4.clinicalCrib.pathology': 'Dx RN corregido' });
      remoteWrite(
        { R4: mother(RN_A(), 'Madre M2 Sintética', 'ep-M2', '12.121.212-1'), R6: E() },
        '2026-10-24T09:50:00.000Z'
      );

      await replay();

      expect(remote().beds.R4).toMatchObject({ patientName: 'Madre M2 Sintética' });
      // The departed mother's stored handoff entries make the merge hold the edit, not drop them.
      const published = remote().beds.R4.clinicalCrib?.pathology === 'Dx RN corregido';
      const held = (await dayTasks()).map(
        task => (task.payload as DailyRecord).beds.R4.clinicalCrib?.pathology
      );
      expect(published || held.includes('Dx RN corregido')).toBe(true);
    });
  }
);

describe('enforced mode keeps a stale day write queued, as main does', () => {
  it('never overwrites a change the edit never saw, hidden behind a later write', async () => {
    await readStored({ R4: A('R4'), R6: E(), R7: F() }, undefined, {
      revision: 5,
      lastChangedPaths: ['beds.R7.status'],
    });
    await writeDay({ 'beds.R6.pathology': 'Dx E local' });
    // W1 wrote the same field; W2, the last writer, another bed.
    remoteWrite(
      { R4: A('R4'), R6: E({ pathology: 'Dx E W1' }), R7: F({ pathology: 'Dx F W2' }) },
      '2026-10-24T10:20:00.000Z',
      { revision: 7, lastChangedPaths: ['beds.R7.pathology'] }
    );
    h.authorityMode = true;

    await reconnect();

    expect(remote().beds.R6.pathology).toBe('Dx E W1');
    await expectDayEditsPublishedOrKept(true, { 'beds.R6.pathology': 'Dx E local' });
  });

  it('keeps a stale whole-record save queued instead of dropping its edit', async () => {
    await readStored({ R4: A('R4'), R6: E() }, undefined, { revision: 5 });
    const shown = await local();
    await saveWholeDay({
      ...shown,
      beds: { ...shown.beds, R6: { ...shown.beds.R6, pathology: 'Dx E entero' } },
    });
    remoteWrite({ R4: B(), R6: E() }, '2026-10-24T10:15:00.000Z', {
      revision: 6,
      lastChangedPaths: ['beds.R4'],
    });
    h.authorityMode = true;

    await reconnect();

    expect(remote().beds.R4.patientName).toBe('Paciente B Sintético');
    await expectDayEditsPublishedOrKept(true, { 'beds.R6.pathology': 'Dx E entero' });
  });
});
