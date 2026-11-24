import { captureAuthoringSession } from '@/services/session/authoringSession';
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
  dayTasks,
  expectBInR4,
  expectDayEditsKept,
  local,
  queue,
  readStored,
  remote,
  remoteWrite,
  resetDay,
  saveWholeDay,
  writeDay,
} from './dayRecordDaySupport';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
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
  it('drops stale edits written for A without creating detached tasks, while another bed syncs', async () => {
    const base = day(DATE, { R4: A('R4', { pathology: 'Dx A' }), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeDayNow(base, { 'beds.R4.pathology': 'Dx A corregido' });
    await writeDayNow(await local(), { 'beds.R4.diagnosisComments': 'Comentario de A' });
    await writeDayNow(await local(), { 'beds.R6.pathology': 'Dx E corregido' });

    // Same version on the server, another patient in R4: the authority accepts the base.
    h.remote = day(DATE, { R4: { ...B(), pathology: 'Dx B' }, R6: E() }, base.lastUpdated);
    await reconnect();

    expect(remote().beds.R4).toMatchObject({
      patientName: 'Paciente B Sintético',
      pathology: 'Dx B',
    });
    expect(JSON.stringify(remote().beds.R4)).not.toContain('Comentario de A');
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    expect(await queue()).toEqual([]);
    expect((await local()).beds.R4).toMatchObject({
      patientName: 'Paciente B Sintético',
      pathology: 'Dx B',
    });
  });

  it('drains cleanly without writing onto the new occupant when only the departed bed was edited', async () => {
    const base = day(DATE, { R4: A('R4', { pathology: 'Dx A' }), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeDayNow(base, { 'beds.R4.pathology': 'Dx A corregido' });
    h.remote = day(DATE, { R4: { ...B(), pathology: 'Dx B' }, R6: E() }, base.lastUpdated);

    await reconnect();

    expect(remote().beds.R4).toMatchObject({
      patientName: 'Paciente B Sintético',
      pathology: 'Dx B',
    });
    expect(await queue()).toEqual([]);
    expect((await local()).beds.R4).toMatchObject({
      patientName: 'Paciente B Sintético',
      pathology: 'Dx B',
    });
  });
});

describe('a census edit queued while another session replaces a patient', () => {
  const replay = reconnect;

  it('keeps an edit of another bed, and keeps B', async () => {
    const read = await readStored({ R4: A('R4'), R6: E() });
    await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
    expect((await dayTasks()).map(task => task.syncContract?.expectedVersion)).toEqual([
      read.lastUpdated,
    ]);
    h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);

    await replay();

    expectBInR4();
    await expectDayEditsKept({ 'beds.R6.pathology': 'Dx E corregido' });
  });

  it('never writes an edit of the departed patient onto B while keeping edits of another bed', async () => {
    await readStored({ R4: A('R4', { pathology: 'Dx A' }), R6: E() });
    await writeDay({
      'beds.R4.pathology': 'Dx A corregido',
      'beds.R6.pathology': 'Dx E corregido',
    });
    h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);

    await replay();

    expectBInR4();
    expect(remote().beds.R4.pathology).not.toBe('Dx A corregido');
    await expectDayEditsKept({ 'beds.R6.pathology': 'Dx E corregido' });
    expect((await queue()).filter(task => task.key?.includes(':detached:'))).toEqual([]);
  });

  it('publishes several census edits of other beds', async () => {
    await readStored({ R4: A('R4'), R6: E(), R7: F() });
    await writeDay({ 'beds.R6.pathology': 'Dx E v1' }, '2026-10-24T10:40:00.000Z');
    await writeDay({ 'beds.R7.pathology': 'Dx F corregido' }, '2026-10-24T10:42:00.000Z');
    await writeDay({ 'beds.R6.pathology': 'Dx E v2' }, '2026-10-24T10:44:00.000Z');
    h.remote = day(DATE, { R4: B(), R6: E(), R7: F() }, B_AT);

    await replay();

    expectBInR4();
    await expectDayEditsKept({
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
    await expectDayEditsKept({ 'beds.R4.pathology': 'Dx M corregido' });
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
});

describe('the authority keeps a stale day write queued', () => {
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

    await reconnect();

    expect(remote().beds.R6.pathology).toBe('Dx E W1');
    await expectDayEditsKept({ 'beds.R6.pathology': 'Dx E local' });
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

    await reconnect();

    expect(remote().beds.R4.patientName).toBe('Paciente B Sintético');
    await expectDayEditsKept({ 'beds.R6.pathology': 'Dx E entero' });
  });
});
