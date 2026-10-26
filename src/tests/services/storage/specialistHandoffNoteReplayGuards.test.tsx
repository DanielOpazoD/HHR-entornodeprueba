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
    expect(remote().beds.R4.pathology).toBe('Dx M corregido');
    expect(await dayTasks()).toEqual([]);
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
    await saveWholeDay({
      ...staleView,
      beds: { ...staleView.beds, R6: { ...staleView.beds.R6, pathology: 'Dx E entero' } },
    });

    await replay();

    expect(JSON.stringify(remote().beds.R4)).not.toContain('Nota de A');
    expect(remote().beds.R6.pathology).toBe('Dx E entero');
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
