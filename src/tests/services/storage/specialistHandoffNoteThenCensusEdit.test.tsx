/**
 * Synthetic-only: a specialist note written offline (#1026) followed by a census edit on the same
 * day, while another session replaces the bed's patient. Real write service, queue engine,
 * transport, specialist callable and clinical authority handler; only Firestore, Functions and
 * the role are faked. Every case runs in both publication modes.
 */
import 'fake-indexeddb/auto';
import { A, B, C, E, harnessState, patient, reconnect } from './specialistHandoffOutboxHarness';
import {
  B_AT,
  DATE,
  MODES,
  cribNote,
  dayTasks,
  expectBInR4,
  expectRefusedNoteKept,
  local,
  note,
  queue,
  readStored,
  remote,
  resetNoteDay,
  writeDay,
} from './specialistHandoffNoteDaySupport';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { day } from './specialistHandoffOutboxHarness';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const h = harnessState();
const OWNER = 'user:synthetic-note-day';

beforeEach(() => resetNoteDay(OWNER));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(MODES)(
  'a census edit queued after a note written offline (%s)',
  (_mode, enforced) => {
    const replay = async () => {
      h.authorityMode = enforced;
      await reconnect();
    };

    it('never writes A back over B, and the note never reaches B', async () => {
      await readStored({ R4: A('R4'), R6: E() });
      await note('R4', 'entry-A', 'Nota de A');
      await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
      expect((await local()).lastUpdated).toBe('2026-10-24T10:45:00.000Z');
      expect((await dayTasks()).map(task => task.syncContract?.expectedVersion)).toEqual([
        '2026-10-24T10:00:00.000Z',
      ]);
      h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);

      await replay();

      expectBInR4();
      expect(remote().beds.R6.pathology).toBe('Dx E corregido');
      expect(await dayTasks()).toEqual([]);
      await expectRefusedNoteKept();
    });

    it('publishes a note on another bed and keeps B when two notes were written', async () => {
      await readStored({ R4: A('R4'), H1C1: C(), R6: E() });
      await note('R4', 'entry-A', 'Nota de A', '2026-10-24T10:30:00.000Z');
      await note('H1C1', 'entry-C', 'Nota de C', '2026-10-24T10:35:00.000Z');
      await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
      h.remote = day(DATE, { R4: B(), H1C1: C(), R6: E() }, B_AT);

      await replay();

      expectBInR4();
      expect(remote().beds.H1C1.medicalHandoffNote).toBe('Nota de C');
      expect(remote().beds.R6.pathology).toBe('Dx E corregido');
      expect(await dayTasks()).toEqual([]);
      await expectRefusedNoteKept();
    });

    it('keeps an edit of the departed patient, not written on B, when it edits the same bed', async () => {
      await readStored({ R4: A('R4', { pathology: 'Dx A' }), R6: E() });
      await note('R4', 'entry-A', 'Nota de A');
      await writeDay({
        'beds.R4.pathology': 'Dx A corregido',
        'beds.R6.pathology': 'Dx E corregido',
      });
      h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);

      await replay();

      expectBInR4();
      expect(remote().beds.R4.pathology).not.toBe('Dx A corregido');
      expect(remote().beds.R6.pathology).toBe('Dx E corregido');
      const held = (await queue()).filter(
        task => task.type === 'UPDATE_DAILY_RECORD' && task.status === 'CONFLICT'
      );
      expect(held.map(task => (task.payload as DailyRecord).beds.R4.pathology)).toEqual([
        'Dx A corregido',
      ]);
      await expectRefusedNoteKept();
    });

    it('publishes several census edits made after the note', async () => {
      const F = () =>
        patient('R7', 'Paciente F Sintético', { rut: '55.555.555-5', pathology: 'Dx F' });
      await readStored({ R4: A('R4'), R6: E(), R7: F() });
      await note('R4', 'entry-A', 'Nota de A');
      await writeDay({ 'beds.R6.pathology': 'Dx E v1' }, '2026-10-24T10:40:00.000Z');
      await writeDay({ 'beds.R7.pathology': 'Dx F corregido' }, '2026-10-24T10:42:00.000Z');
      await writeDay({ 'beds.R6.pathology': 'Dx E v2' }, '2026-10-24T10:44:00.000Z');
      h.remote = day(DATE, { R4: B(), R6: E(), R7: F() }, B_AT);

      await replay();

      expectBInR4();
      expect(remote().beds.R6.pathology).toBe('Dx E v2');
      expect(remote().beds.R7.pathology).toBe('Dx F corregido');
      expect(await dayTasks()).toEqual([]);
      await expectRefusedNoteKept();
    });

    it('never writes the departed newborn back over the crib, nor its note', async () => {
      const newborn = (name: string, episode: string, rut: string) =>
        patient('R4', name, {
          rut,
          clinicalEpisodeId: episode,
          medicalHandoffEntries: [{ id: 'entry-RN', specialty: 'Medicina Interna', note: '' }],
        } as Partial<PatientData>);
      const mother = (crib: PatientData) =>
        patient('R4', 'Madre M Sintética', {
          rut: '33.333.333-3',
          clinicalEpisodeId: 'ep-M',
          clinicalCrib: crib,
        });
      await readStored({
        R4: mother(newborn('RN A Sintético', 'ep-RNA', '44.444.444-4')),
        R6: E(),
      });
      await cribNote('R4', 'entry-RN', 'Nota de RN A');
      await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
      h.remote = day(
        DATE,
        { R4: mother(newborn('RN B Sintético', 'ep-RNB', '22.222.222-2')), R6: E() },
        B_AT
      );

      await replay();

      expect(remote().beds.R4.clinicalCrib).toMatchObject({
        patientName: 'RN B Sintético',
        clinicalEpisodeId: 'ep-RNB',
      });
      expect(JSON.stringify(remote().beds.R4)).not.toContain('Nota de RN A');
      expect(remote().beds.R6.pathology).toBe('Dx E corregido');
      expect(await dayTasks()).toEqual([]);
      await expectRefusedNoteKept('RN A Sintético', 'entry-RN', 'Nota de RN A');
    });

    it('starts a later edit from the day a published note left, and publishes both', async () => {
      await readStored({ R4: A('R4'), R6: E() });
      await note('R4', 'entry-A', 'Nota de A', '2026-10-24T10:30:00.000Z', false);
      const before = await local();
      await writeDay({ 'beds.R6.pathology': 'Dx E corregido' }, '2026-10-24T12:30:00.000Z');
      const [task] = await dayTasks();
      expect(task.syncContract?.expectedVersion).toBe(before.lastUpdated);
      expect(task.syncContract?.expectedVersion).not.toBe('2026-10-24T10:30:00.000Z');

      await replay();

      expect(remote().beds.R4.medicalHandoffNote).toBe('Nota de A');
      expect(remote().beds.R6.pathology).toBe('Dx E corregido');
      expect(await queue()).toEqual([]);
    });

    it('publishes the note and the edit, with no conflict, when nobody else wrote', async () => {
      await readStored({ R4: A('R4'), R6: E() });
      await note('R4', 'entry-A', 'Nota de A');
      await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });

      await replay();

      expect(remote().beds.R4.medicalHandoffNote).toBe('Nota de A');
      expect(remote().beds.R6.pathology).toBe('Dx E corregido');
      expect(await queue()).toEqual([]);
    });

    it('changes nothing for a census edit with no pending note, and keeps B', async () => {
      const read = await readStored({ R4: A('R4'), R6: E() });
      await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
      expect((await dayTasks()).map(task => task.syncContract?.expectedVersion)).toEqual([
        read.lastUpdated,
      ]);
      h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);

      await replay();

      expectBInR4();
      expect(remote().beds.R6.pathology).toBe('Dx E corregido');
      expect(await queue()).toEqual([]);
    });

    it('keeps B when another user edits the census after this user wrote a note offline', async () => {
      await readStored({ R4: A('R4'), R6: E() });
      await note('R4', 'entry-A', 'Nota de A');
      localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-other-user');
      const before = await local();
      await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
      expect((await dayTasks()).map(task => task.syncContract?.expectedVersion)).toEqual([
        before.lastUpdated,
      ]);
      h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);

      await replay();
      expectBInR4();
      expect(remote().beds.R6.pathology).toBe('Dx E corregido');
      localStorage.setItem('hhr_session_owner_v1', OWNER);
      await replay();

      expectBInR4();
      await expectRefusedNoteKept();
    });
  }
);
