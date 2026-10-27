/**
 * Synthetic-only: replay guards for a day write around specialist notes. A slot (the bed's
 * patient or the crib's newborn) holding another patient is never written from the stale copy,
 * a note queued before this fix never lets a day write revert what it never saw, a whole-record
 * save never publishes a note, and enforced mode keeps a stale day write queued, as main does.
 */
import 'fake-indexeddb/auto';
import { A, E, harnessState, patient, reconnect } from './specialistHandoffOutboxHarness';
import {
  DATE,
  MODES,
  asQueuedBeforeFix,
  cribNote,
  dayTasks,
  expectDayEditsPublishedOrKept,
  expectRefusedNoteKept,
  local,
  note,
  queue,
  readStored,
  remote,
  remoteWrite,
  resetNoteDay,
  saveWholeDay,
  writeDay,
} from './specialistHandoffNoteDaySupport';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';

const h = harnessState();
const OWNER = 'user:synthetic-replay-guards';
const F = (extra: Partial<PatientData> = {}) =>
  patient('R7', 'Paciente F Sintético', {
    rut: '55.555.555-5',
    clinicalEpisodeId: 'ep-F',
    pathology: 'Dx F',
    ...extra,
  });
const newborn = (name: string, episode: string, rut: string) =>
  patient('R4', name, {
    rut,
    clinicalEpisodeId: episode,
    medicalHandoffEntries: [{ id: 'entry-RN', specialty: 'Medicina Interna', note: '' }],
  } as Partial<PatientData>);
const mother = (
  crib: PatientData,
  name = 'Madre M Sintética',
  episode = 'ep-M',
  rut = '33.333.333-3'
) =>
  patient('R4', name, {
    rut,
    clinicalEpisodeId: episode,
    medicalHandoffEntries: [{ id: 'entry-M', specialty: 'Medicina Interna', note: '' }],
    clinicalCrib: crib,
  } as Partial<PatientData>);
const RN_A = () => newborn('RN A Sintético', 'ep-RNA', '44.444.444-4');
const RN_B = () => newborn('RN B Sintético', 'ep-RNB', '22.222.222-2');

beforeEach(() => resetNoteDay(OWNER));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(MODES)('day write replay guards (%s)', (_mode, enforced) => {
  const replay = async () => {
    h.authorityMode = enforced;
    await reconnect();
  };
  /** Specialists write only the current clinical day; this one is closed, so notes are refused. */
  const replayRefusingNotes = async () => {
    h.role = 'doctor_specialist';
    await replay();
    h.role = 'admin';
  };

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
    // The departed mother's handoff entries make the merge hold the edit rather than drop them.
    const published = remote().beds.R4.clinicalCrib?.pathology === 'Dx RN corregido';
    const held = (await dayTasks()).map(
      task => (task.payload as DailyRecord).beds.R4.clinicalCrib?.pathology
    );
    expect(published || held.includes('Dx RN corregido')).toBe(true);
  });

  it('keeps the newborn another session admitted after a crib note refused before this fix', async () => {
    await readStored({ R4: mother(RN_A()), R6: E() });
    await cribNote('R4', 'entry-RN', 'Nota de RN A');
    await asQueuedBeforeFix('CONFLICT');
    remoteWrite({ R4: mother(RN_B()), R6: E() }, '2026-10-24T10:15:00.000Z');
    await writeDay({ 'beds.R4.pathology': 'Dx M corregido' });

    await replay();

    expect(remote().beds.R4.clinicalCrib).toMatchObject({ patientName: 'RN B Sintético' });
    expect(JSON.stringify(remote().beds.R4)).not.toContain('Nota de RN A');
  });

  it('never reverts another bed with an edit queued after a note refused before this fix', async () => {
    await readStored({ R4: A('R4'), R6: E(), R7: F() });
    await note('R4', 'entry-A', 'Nota de A');
    await asQueuedBeforeFix('CONFLICT');
    remoteWrite(
      { R4: A('R4'), R6: E({ pathology: 'Dx E remoto' }), R7: F() },
      '2026-10-24T10:15:00.000Z',
      {
        revision: 6,
        lastChangedPaths: ['beds.R6.pathology'],
      }
    );
    await writeDay({ 'beds.R7.pathology': 'Dx F corregido' });

    await replay();

    expect(remote().beds.R6.pathology).toBe('Dx E remoto');
    expect(remote().beds.R4.medicalHandoffNote).toBe('');
    await expectDayEditsPublishedOrKept(enforced, { 'beds.R7.pathology': 'Dx F corregido' });
  });

  it('merges an edit queued with a note from before this fix refused in the same pass', async () => {
    await readStored({ R4: A('R4'), R6: E(), R7: F() });
    await note('R4', 'entry-A', 'Nota de A');
    await asQueuedBeforeFix();
    await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
    remoteWrite(
      { R4: A('R4'), R6: E(), R7: F({ pathology: 'Dx F remoto' }) },
      '2026-10-24T10:15:00.000Z',
      {
        revision: 6,
        lastChangedPaths: ['beds.R7.pathology'],
      }
    );

    await replayRefusingNotes();

    expect(remote().beds.R7.pathology).toBe('Dx F remoto');
    expect(remote().beds.R4.medicalHandoffNote).toBe('');
    await expectDayEditsPublishedOrKept(enforced, { 'beds.R6.pathology': 'Dx E corregido' });
  });

  it.each([
    ['bed', true],
    ['bed', false],
    ['clinicalCrib', true],
    ['clinicalCrib', false],
  ] as const)(
    'keeps identical note text owned by a new %s occupant (remote exists: %s)',
    async (slot, exists) => {
      await readStored({ R4: slot === 'bed' ? A('R4') : mother(RN_A()), R6: E() });
      if (slot === 'bed') await note('R4', 'entry-A', 'Texto compartido');
      else await cribNote('R4', 'entry-RN', 'Texto compartido');
      const projected = await local();
      const occupant = (record: DailyRecord) =>
        slot === 'bed' ? record.beds.R4 : record.beds.R4.clinicalCrib!;
      const noteFields = Object.fromEntries(
        [
          'medicalHandoffEntries',
          'medicalHandoffNote',
          'medicalHandoffAudit',
          'clinicalEvents',
        ].map(field => [field, occupant(projected)[field as keyof PatientData]])
      );
      await replayRefusingNotes();
      const newPatient =
        slot === 'bed'
          ? A('R4', {
              patientName: 'Paciente B Sintético',
              rut: '88.888.888-8',
              clinicalEpisodeId: 'ep-B',
            })
          : RN_B();
      const fresh = await readStored({
        R4: slot === 'bed' ? newPatient : mother(newPatient),
        R6: E(),
      });
      const edited = { ...newPatient, ...noteFields };
      if (!exists) h.remote = null;
      await saveWholeDay(
        {
          ...fresh,
          beds: {
            ...fresh.beds,
            R4: slot === 'bed' ? edited : mother(edited),
            R6: { ...fresh.beds.R6, handoffNote: 'Entrega E conservada' },
          },
        },
        undefined,
        fresh
      );

      await replay();

      expect(occupant(remote()).medicalHandoffNote).toBe('Texto compartido');
      expect(occupant(remote()).clinicalEpisodeId).toBe(newPatient.clinicalEpisodeId);
      expect(occupant(await local()).medicalHandoffNote).toBe('Texto compartido');
      expect(remote().beds.R6.handoffNote).toBe('Entrega E conservada');
      expect(await dayTasks()).toEqual([]);
      expect(
        (await queue()).filter(task => task.type === 'UPDATE_SPECIALIST_HANDOFF')
      ).toMatchObject([{ status: 'CONFLICT' }]);
    }
  );

  it('never publishes a pending note through a whole-record save', async () => {
    await readStored({ R4: A('R4'), R6: E() });
    await note('R4', 'entry-A', 'Nota de A');
    const shown = await local();
    await saveWholeDay({
      ...shown,
      beds: { ...shown.beds, R6: { ...shown.beds.R6, pathology: 'Dx E entero' } },
    });

    await replayRefusingNotes();

    expect(JSON.stringify(remote().beds.R4)).not.toContain('Nota de A');
    expect(remote().beds.R6.pathology).toBe('Dx E entero');
  });

  it('never publishes a refused note through a whole-record save from a view still showing it', async () => {
    await readStored({ R4: A('R4'), R6: E() });
    await note('R4', 'entry-A', 'Nota de A');
    const staleView = await local();
    await replayRefusingNotes();
    await expect(
      saveWholeDay({
        ...staleView,
        beds: { ...staleView.beds, R6: { ...staleView.beds.R6, pathology: 'Dx E entero' } },
      })
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    const fresh = await local();
    await saveWholeDay(
      {
        ...fresh,
        beds: { ...fresh.beds, R6: { ...fresh.beds.R6, pathology: 'Dx E entero' } },
      },
      undefined,
      fresh
    );

    await replay();

    expect(JSON.stringify(remote().beds.R4)).not.toContain('Nota de A');
    expect(remote().beds.R6.pathology).toBe('Dx E entero');
  });

  it.each(['newer', 'missing'] as const)(
    'keeps a refused note out of a stale whole-day save when the remote day is %s',
    async remoteState => {
      await readStored({ R4: A('R4'), R6: E() });
      await note('R4', 'entry-A', 'Nota de A');
      const staleView = await local();
      await replayRefusingNotes();
      if (remoteState === 'newer') {
        remoteWrite({ R4: A('R4'), R6: E() }, '2026-10-24T10:20:00.000Z');
      } else {
        h.remote = null;
      }
      await expect(
        saveWholeDay({
          ...staleView,
          beds: {
            ...staleView.beds,
            R6: { ...staleView.beds.R6, handoffNote: 'Entrega E conservada' },
          },
        })
      ).rejects.toMatchObject({ name: 'ConcurrencyError' });
      const fresh = await local();
      await saveWholeDay(
        {
          ...fresh,
          beds: { ...fresh.beds, R6: { ...fresh.beds.R6, handoffNote: 'Entrega E conservada' } },
        },
        undefined,
        fresh
      );

      await replay();

      expect(JSON.stringify(h.remote)).not.toContain('Nota de A');
      const published = h.remote?.beds.R6?.handoffNote === 'Entrega E conservada';
      const held = (await dayTasks()).some(
        task => (task.payload as DailyRecord).beds.R6.handoffNote === 'Entrega E conservada'
      );
      expect(published || held).toBe(true);
      await expectRefusedNoteKept();
    }
  );

  it('does not replay the first note over its later confirmed edit through a pending whole-day save', async () => {
    await readStored({ R4: A('R4'), R6: E() });
    await note('R4', 'entry-A', 'Nota primera');
    const shown = await local();
    await saveWholeDay({
      ...shown,
      beds: { ...shown.beds, R6: { ...shown.beds.R6, handoffNote: 'Entrega E conservada' } },
    });
    await note('R4', 'entry-A', 'Nota confirmada', '2026-10-24T10:50:00.000Z');
    // Another census save still shows the first projection and queues after the note edit.
    await saveWholeDay(await local(), '2026-10-24T10:55:00.000Z');

    await replay();

    expect(remote().beds.R4.medicalHandoffNote).toBe('Nota confirmada');
    expect(JSON.stringify((await local()).beds.R4)).not.toContain('Nota primera');
    expect((await queue()).filter(task => task.type === 'UPDATE_SPECIALIST_HANDOFF')).toEqual([]);
    await expectDayEditsPublishedOrKept(enforced, {
      'beds.R6.handoffNote': 'Entrega E conservada',
    });
  });

  it('keeps a confirmed note when retrying a whole-day task that existed before the note', async () => {
    await readStored({ R4: A('R4'), R6: E() });
    const shown = await local();
    await saveWholeDay({
      ...shown,
      beds: { ...shown.beds, R6: { ...shown.beds.R6, handoffNote: 'Entrega E conservada' } },
    });
    const [heldDay] = await dayTasks();
    await hospitalDB.syncQueue.update(heldDay.id!, { status: 'CONFLICT' });
    await note('R4', 'entry-A', 'Nota confirmada', '2026-10-24T10:50:00.000Z');
    await replay();
    expect(remote().beds.R4.medicalHandoffNote).toBe('Nota confirmada');
    expect((await local()).beds.R4.medicalHandoffNote).toBe('Nota confirmada');

    expect(await createDexieSyncQueueStore().requeueQuarantinedTask!(heldDay.id!, OWNER)).toBe(
      true
    );
    await replay();

    expect(remote().beds.R4.medicalHandoffNote).toBe('Nota confirmada');
    await expectDayEditsPublishedOrKept(enforced, {
      'beds.R6.handoffNote': 'Entrega E conservada',
    });
  });

  it('tells the view to refresh the day a refused note no longer shapes', async () => {
    await readStored({ R4: A('R4'), R6: E() });
    await note('R4', 'entry-A', 'Nota de A');
    const dates: string[][] = [];
    const listener = (event: Event) =>
      dates.push((event as CustomEvent<{ dates?: string[] }>).detail.dates ?? []);
    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, listener);
    try {
      await replayRefusingNotes();
    } finally {
      window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, listener);
    }

    expect(dates).toContainEqual([DATE]);
    expect((await local()).beds.R4.medicalHandoffNote).toBe('');
  });

  it.each([true, false])(
    'holds a legacy whole-day retry with an unknown base after note confirmation (remote exists: %s)',
    async remoteExists => {
      await readStored({ R4: A('R4'), R6: E() });
      const shown = await local();
      await saveWholeDay({
        ...shown,
        beds: { ...shown.beds, R6: { ...shown.beds.R6, handoffNote: 'Entrega E conservada' } },
      });
      const [heldDay] = await dayTasks();
      await hospitalDB.syncQueue.update(heldDay.id!, { status: 'CONFLICT' });
      await note('R4', 'entry-A', 'Nota confirmada', '2026-10-24T10:50:00.000Z');
      await asQueuedBeforeFix();
      await replay();
      expect(remote().beds.R4.medicalHandoffNote).toBe('Nota confirmada');
      if (!remoteExists) h.remote = null;
      expect(await createDexieSyncQueueStore().requeueQuarantinedTask!(heldDay.id!, OWNER)).toBe(
        true
      );

      await replay();

      if (remoteExists) expect(remote().beds.R4.medicalHandoffNote).toBe('Nota confirmada');
      else expect(h.remote).toBeNull();
      const tasks = await dayTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('CONFLICT');
      expect((tasks[0].payload as DailyRecord).beds.R6.handoffNote).toBe('Entrega E conservada');
    }
  );

  it('shows neither note once two users notes on the same patient are refused, in either order', async () => {
    const entries = [
      { id: 'entry-A', specialty: 'Medicina Interna', note: '' },
      { id: 'entry-A2', specialty: 'Cirugía', note: '' },
    ];
    await readStored({
      R4: A('R4', { medicalHandoffEntries: entries } as Partial<PatientData>),
      R6: E(),
    });
    await note('R4', 'entry-A', 'Nota de X', '2026-10-24T10:30:00.000Z');
    localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-second-user');
    await note('R4', 'entry-A2', 'Nota de Y', '2026-10-24T10:35:00.000Z');
    // The first user's note is refused first, while the second user's projection covers it.
    localStorage.setItem('hhr_session_owner_v1', OWNER);
    await replayRefusingNotes();
    localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-second-user');
    await replayRefusingNotes();

    const shown = JSON.stringify((await local()).beds.R4);
    expect(shown).not.toContain('Nota de X');
    expect(shown).not.toContain('Nota de Y');
    expect((await queue()).map(task => task.status)).toEqual(['CONFLICT', 'CONFLICT']);
  });
});

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
    remoteWrite(
      {
        R4: patient('R4', 'Paciente B Sintético', {
          rut: '88.888.888-8',
          clinicalEpisodeId: 'ep-B',
        }),
        R6: E(),
      },
      '2026-10-24T10:15:00.000Z',
      {
        revision: 6,
        lastChangedPaths: ['beds.R4'],
      }
    );
    h.authorityMode = true;

    await reconnect();

    expect(remote().beds.R4.patientName).toBe('Paciente B Sintético');
    await expectDayEditsPublishedOrKept(true, { 'beds.R6.pathology': 'Dx E entero' });
  });
});
