/**
 * Synthetic-only: the specialist note unit and the held day edits (#1026) composed with a bed or
 * newborn crib whose stored identity this client cannot read (identity review). Real write
 * service, queue engine, transport and server handler; only Firestore, Functions and the role are
 * faked. Each case checks the stored day, the queue, the drafts and the sync panel.
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
  patient,
  reconnect,
  writeNote,
} from './specialistHandoffOutboxHarness';
import React from 'react';

const h = harnessState();
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { listRecentSyncQueueOperations } from '@/services/storage/sync';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { shouldRouteSpecialistPatchViaCallable } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import type { SyncQueueStats } from '@/hooks/useSyncQueueMonitor';
import type { DailyRecord, DailyRecordPatch } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const DATE = '2026-10-24';
const OWNER = 'user:synthetic-identity-review';
const LATER = '2026-10-24T11:00:00.000Z';
const NOTE_OF_A = 'Nota de entrega de Paciente A Sintético · 24-10-2026';
const CHANGES_OF_A = 'Cambios de Paciente A Sintético · 24-10-2026';
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
const renderPanel = async () => {
  const operations = await listRecentSyncQueueOperations(20);
  const stats = { pending: 0, failed: 0, conflict: 0, retrying: 0, readState: 'ok' };
  render(
    <RayenSyncQueueDetails
      stats={{ ...stats, conflict: operations.length } as SyncQueueStats}
      operations={operations}
      refresh={vi.fn(async () => {})}
      working={false}
    />
  );
};
/** The sync panel resolves the item: no retry, a discard that asks first. */
const discardFromPanel = async (label: string) => {
  const item = screen.getByText(label).closest('li')!;
  expect(within(item).queryByText('Reintentar')).not.toBeInTheDocument();
  const before = await hospitalDB.syncQueue.count();
  fireEvent.click(within(item).getByText('Descartar'));
  expect(await hospitalDB.syncQueue.count()).toBe(before);
  fireEvent.click(within(item).getByText('Sí, descartar envío'));
  await vi.waitFor(async () => expect(await hospitalDB.syncQueue.count()).toBe(before - 1));
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

describe('a bed under identity review with a specialist note and a census edit pending', () => {
  it('holds both for A when B takes the bed, keeps the day current, and resolves both in the panel', async () => {
    const read = await readStored({ R4: A('R4', { documentType: unreadable('Cedula') }), R6: E() });
    expect(read.beds.R4.identityReview?.fields).toEqual(['documentType']);
    await writeNote(read, 'R4', 'entry-A', 'Nota de A');
    await writeDay({ 'beds.R4.pathology': 'Dx A pendiente' });
    await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
    h.remote = day(DATE, { R4: { ...B(), pathology: 'Dx B' }, R6: E() }, LATER);

    await reconnect();

    expect(remote().beds.R4).toMatchObject({
      patientName: 'Paciente B Sintético',
      pathology: 'Dx B',
    });
    expect(JSON.stringify(remote().beds.R4)).not.toMatch(/Nota de A|Dx A pendiente/);
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    const tasks = await queue();
    expect(tasks.map(task => [task.type, task.status]).sort()).toEqual([
      ['UPDATE_DAILY_RECORD', 'CONFLICT'],
      ['UPDATE_SPECIALIST_HANDOFF', 'CONFLICT'],
    ]);
    const held = tasks.find(task => task.type === 'UPDATE_DAILY_RECORD')!;
    expect(held.key).toContain(':detached:');
    expect(held).toMatchObject({
      lastErrorCode: 'occupant_changed',
      syncContract: { changedPaths: ['beds.R4.pathology'] },
    });
    expect((held.payload as DailyRecord).beds.R4).toMatchObject({
      clinicalEpisodeId: 'ep-A',
      pathology: 'Dx A pendiente',
    });
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
    // Nothing holds the day back: this device shows what the bed holds now.
    expect((await local()).beds.R4).toMatchObject({ patientName: 'Paciente B Sintético' });

    await renderPanel();
    await discardFromPanel(NOTE_OF_A);
    await discardFromPanel(CHANGES_OF_A);
    expect(await queue()).toEqual([]);
    expect(remote().beds.R4).toMatchObject({
      patientName: 'Paciente B Sintético',
      pathology: 'Dx B',
    });
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
  });

  it('writes the diagnosis of the same patient after another session repaired only the type', async () => {
    const read = await readStored({ R4: A('R4', { documentType: unreadable('Cedula') }), R6: E() });
    await writeNote(read, 'R4', 'entry-A', 'Nota de A');
    await writeDay({ 'beds.R4.pathology': 'Dx A pendiente' });
    h.remote = day(DATE, { R4: A('R4', { documentType: 'Pasaporte' }), R6: E() }, LATER);

    await reconnect();

    expect(remote().beds.R4).toMatchObject({
      clinicalEpisodeId: 'ep-A',
      documentType: 'Pasaporte',
      pathology: 'Dx A pendiente',
    });
    // The note named a type the read could not show: the server cannot match it, so it is held
    // as a draft of A, never written by bed.
    expect((await queue()).map(task => [task.type, task.status])).toEqual([
      ['UPDATE_SPECIALIST_HANDOFF', 'CONFLICT'],
    ]);
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
    await renderPanel();
    await discardFromPanel(NOTE_OF_A);
  });

  it('refuses, as a conflict the panel resolves, a note for a patient whose stored RUT is not text', async () => {
    const read = await readStored({ R4: A('R4', { rut: unreadable(12345678) }), R6: E() });
    expect(read.beds.R4.identityReview?.fields).toEqual(['rut']);
    await writeNote(read, 'R4', 'entry-A', 'Nota de A');

    await reconnect();

    expect((await queue()).map(task => [task.type, task.status])).toEqual([
      ['UPDATE_SPECIALIST_HANDOFF', 'CONFLICT'],
    ]);
    expect(remote().beds.R4).toMatchObject({ rut: 12345678, medicalHandoffNote: '' });
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
    await renderPanel();
    await discardFromPanel(NOTE_OF_A);
  });

  it.each<[string, Record<string, unknown> | 'crib']>([
    ['its own field', { 'beds.R4.clinicalCrib.pathology': 'Dx RN pendiente' }],
    ['the whole crib', 'crib'],
  ])(
    'holds a newborn diagnosis queued as %s when another newborn takes the crib',
    async (_label, edit) => {
      const newborn = (name: string, episode: string, extra: Partial<PatientData> = {}) =>
        patient('R4', name, { rut: '55.555.555-5', clinicalEpisodeId: episode, ...extra });
      const read = await readStored({
        R4: A('R4', {
          clinicalCrib: newborn('RN A Sintético', 'ep-RN-A', {
            documentType: unreadable('Cedula'),
          }),
        }),
      });
      expect(read.beds.R4.clinicalCrib?.identityReview?.fields).toEqual(['documentType']);
      await writeDay(
        edit === 'crib'
          ? {
              'beds.R4.clinicalCrib': {
                ...read.beds.R4.clinicalCrib,
                pathology: 'Dx RN pendiente',
              },
            }
          : edit
      );
      h.remote = day(
        DATE,
        { R4: A('R4', { clinicalCrib: newborn('RN B Sintético', 'ep-RN-B') }) },
        LATER
      );

      await reconnect();

      expect(remote().beds.R4.patientName).toBe('Paciente A Sintético');
      expect(remote().beds.R4.clinicalCrib).toMatchObject({ clinicalEpisodeId: 'ep-RN-B' });
      expect(JSON.stringify(remote().beds.R4)).not.toContain('Dx RN pendiente');
      const [held, ...rest] = await queue();
      expect(rest).toEqual([]);
      expect(held.key).toContain(':detached:');
      expect((held.payload as DailyRecord).beds.R4.clinicalCrib).toMatchObject({
        clinicalEpisodeId: 'ep-RN-A',
        pathology: 'Dx RN pendiente',
      });
      await renderPanel();
      await discardFromPanel('Cambios de RN A Sintético · 24-10-2026');
      expect(remote().beds.R4.clinicalCrib).toMatchObject({ clinicalEpisodeId: 'ep-RN-B' });
    }
  );
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
