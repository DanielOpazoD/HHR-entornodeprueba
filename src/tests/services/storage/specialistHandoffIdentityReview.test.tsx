/**
 * Synthetic-only: the specialist note unit and the held day edits (#1026) composed with a bed or
 * newborn crib whose stored identity this client cannot read (identity review). Real write
 * service, queue engine, transport and server handler; only Firestore, Functions and the role are
 * faked.
 */
import 'fake-indexeddb/auto';
import {
  A,
  B,
  E,
  clone,
  createServerHandler,
  day,
  draftsFor,
  harnessState,
  reconnect,
  writeNote,
} from './specialistHandoffOutboxHarness';

const h = harnessState();
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { shouldRouteSpecialistPatchViaCallable } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import type { DailyRecord, DailyRecordPatch } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const DATE = '2026-10-24';
const OWNER = 'user:synthetic-identity-review';
const LATER = '2026-10-24T11:00:00.000Z';
const local = async () => (await hospitalDB.dailyRecords.get(DATE)) as DailyRecord;
const remote = () => h.remote as unknown as DailyRecord;
const queue = () => hospitalDB.syncQueue.toArray();
const unreadable = (value: unknown) => value as never;

/** Firestore holds `beds`; this device read them, so a bed it cannot read is under review. */
const readStored = async (beds: Record<string, PatientData>) => {
  h.remote = day(DATE, beds);
  const read = docToRecord(clone(h.remote) as never, DATE);
  await hospitalDB.dailyRecords.put(read);
  return read;
};
/** A census edit, offline: it goes through the day task. */
const writeDay = async (patch: Record<string, unknown>) => {
  vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(false);
  h.offline = true;
  try {
    return await updatePartialDetailed(DATE, patch as DailyRecordPatch, {
      baseRecord: await local(),
    });
  } finally {
    h.offline = false;
    vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(true);
  }
};
beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  resetMedicalHandoffDraftMemoryForTests();
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', OWNER);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  h.handler = createServerHandler();
  h.role = 'admin';
  h.offline = false;
  h.loseNextResponse = false;
  h.authorityMode = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a census edit queued after a note written offline', () => {
  it.each([
    ['another bed', false, { 'beds.R6.pathology': 'Dx E corregido' }],
    ['the type of A, under review', true, { 'beds.R4.documentType': 'Pasaporte' }],
  ])('never writes A back over B when it edits %s', async (_label, reviewed, patch) => {
    const read = await readStored({
      R4: A('R4', reviewed ? { documentType: unreadable('Cedula') } : {}),
      R6: E(),
    });
    await writeNote(read, 'R4', 'entry-A', 'Nota de A');
    await writeDay(patch);
    h.remote = day(DATE, { R4: B(), R6: E() }, LATER);

    await reconnect();

    expect(remote().beds.R4).toMatchObject({
      patientName: 'Paciente B Sintético',
      clinicalEpisodeId: 'ep-B',
      documentType: 'RUT',
      medicalHandoffNote: '',
    });
    expect(remote().beds.R6.pathology).toBe(reviewed ? 'Dx E' : 'Dx E corregido');
    const tasks = await queue();
    expect(tasks.filter(task => task.key === `daily:${DATE}`)).toEqual([]);
    expect(tasks.find(task => task.type === 'UPDATE_SPECIALIST_HANDOFF')?.status).toBe('CONFLICT');
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
  });
});
