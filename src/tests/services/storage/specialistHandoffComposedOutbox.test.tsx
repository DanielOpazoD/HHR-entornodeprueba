/**
 * Synthetic-only: the note sync unit (#1026) composed with the outbox compaction (#1024).
 * Each case observes the local projection, the queue and the remote day.
 */
import 'fake-indexeddb/auto';
import {
  A,
  B,
  C,
  E,
  T0,
  clone,
  createServerHandler,
  day,
  draftsFor,
  harnessState,
  reconnect,
  writeNote,
} from './specialistHandoffOutboxHarness';
import React from 'react';

const h = harnessState();
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { listRecentSyncQueueOperations } from '@/services/storage/sync';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { shouldRouteSpecialistPatchViaCallable } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import {
  createMedicalHandoffDraftWriter,
  readMedicalHandoffDrafts,
  resetMedicalHandoffDraftMemoryForTests,
  writeMedicalHandoffDraft,
} from '@/services/storage/medicalHandoffDraftStorage';
import { buildSpecialistHandoffIdentity } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import type { SyncQueueStats } from '@/hooks/useSyncQueueMonitor';
import type { DailyRecord, DailyRecordPatch } from '@/types/domain/dailyRecord';

const DATE = '2026-10-24';
const OWNER = 'user:synthetic-composed';
const local = async () => (await hospitalDB.dailyRecords.get(DATE)) as DailyRecord;
const remote = () => h.remote as unknown as DailyRecord;
const noteOf = (record: DailyRecord, bedId: string) =>
  record.beds[bedId]?.medicalHandoffEntries?.[0]?.note;
/** A day edit by a role that writes the census directly: it goes through the day task. */
const writeDay = async (record: DailyRecord, patch: Record<string, unknown>) => {
  vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(false);
  h.offline = true;
  try {
    return await updatePartialDetailed(DATE, patch as DailyRecordPatch, { baseRecord: record });
  } finally {
    h.offline = false;
    vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(true);
  }
};
const notePatch = (record: DailyRecord, bedId: string, value: string) => ({
  [`beds.${bedId}.medicalHandoffNote`]: value,
  [`beds.${bedId}.medicalHandoffEntries`]: [
    { ...record.beds[bedId].medicalHandoffEntries![0], note: value },
  ],
});
const queue = async () => hospitalDB.syncQueue.toArray();

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
  h.callableCalls = 0;
});
afterEach(() => cleanup());

describe('a day task never writes a patient edits to the next occupant', () => {
  it('detaches a diagnosis and a note written for A as one conflict, while another bed syncs', async () => {
    const base = day(DATE, { R4: A('R4', { pathology: 'Dx A' }), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeDay(base, { 'beds.R4.pathology': 'Dx A corregido' });
    await writeDay(await local(), notePatch(base, 'R4', 'Nota de A'));
    await writeDay(await local(), { 'beds.R6.pathology': 'Dx E corregido' });

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
    expect(JSON.stringify(remote().beds.R4)).not.toContain('Nota de A');
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    const [conflict, ...rest] = await queue();
    expect(rest).toEqual([]);
    expect(conflict).toMatchObject({ status: 'CONFLICT', type: 'UPDATE_DAILY_RECORD' });
    expect(conflict.key).toContain(':detached:');
    expect(conflict.syncContract?.changedPaths).toEqual(
      expect.arrayContaining(['beds.R4.pathology', 'beds.R4.medicalHandoffEntries'])
    );
    expect((conflict.payload as DailyRecord).beds.R4).toMatchObject({
      clinicalEpisodeId: 'ep-A',
      pathology: 'Dx A corregido',
    });
    expect(noteOf(conflict.payload as DailyRecord, 'R4')).toBe('Nota de A');
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

  it.each([
    ['the browser storage is full', 'quota'],
    ['a draft for that patient already exists', 'existing'],
  ])('keeps a detached note durable when %s', async (_label, failure) => {
    const base = day(DATE, { R4: A(), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeDay(base, notePatch(base, 'R4', 'Nota de A'));
    await writeDay(await local(), { 'beds.R6.pathology': 'Dx E corregido' });
    if (failure === 'existing')
      writeMedicalHandoffDraft(createMedicalHandoffDraftWriter(), {
        date: DATE,
        ...buildSpecialistHandoffIdentity(base.beds.R4),
        entryId: 'otra-entrada',
        value: 'Borrador previo de A',
      });
    const realSetItem = localStorage.setItem;
    if (failure === 'quota')
      localStorage.setItem = (key: string, value: string) => {
        if (key.startsWith('hhr.medicalHandoffDraft'))
          throw new DOMException('Synthetic storage limit', 'QuotaExceededError');
        realSetItem(key, value);
      };
    h.remote = day(DATE, { R4: B(), R6: E() }, '2026-10-24T11:00:00.000Z');
    try {
      await reconnect();
    } finally {
      localStorage.setItem = realSetItem;
    }

    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    const conflicts = (await queue()).filter(task => task.status === 'CONFLICT');
    expect(conflicts).toHaveLength(1);
    expect(noteOf(conflicts[0].payload as DailyRecord, 'R4')).toBe('Nota de A');
    hospitalDB.close();
    await hospitalDB.open();
    expect(noteOf((await queue())[0].payload as DailyRecord, 'R4')).toBe('Nota de A');
  });
});

describe('the note unit composed with the outbox compaction', () => {
  it("keeps A's note off B while the occupant changes, and lets a stale day edit land on the projection", async () => {
    const base = day(DATE, { R4: A(), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeNote(base, 'R4', 'entry-A', 'Nota de A');
    await writeDay(base, { 'beds.R6.pathology': 'Dx E corregido' });
    expect(noteOf(await local(), 'R4')).toBe('Nota de A');
    expect((await local()).beds.R6.pathology).toBe('Dx E corregido');

    h.remote = day(DATE, { R4: B(), R6: E() }, '2026-10-24T11:00:00.000Z');
    await reconnect();

    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    expect(JSON.stringify(remote().beds.R4)).not.toContain('Nota de A');
    expect((await queue()).map(task => [task.type, task.status])).toEqual([
      ['UPDATE_SPECIALIST_HANDOFF', 'CONFLICT'],
    ]);
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
    expect((await local()).beds.R4.patientName).toBe('Paciente B Sintético');
  });

  it('keeps a pending day edit when a later confirmed note is adopted locally', async () => {
    const base = day(DATE, { R4: A(), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeDay(base, { 'beds.R6.pathology': 'Dx E corregido' });
    const online = await writeNote(await local(), 'R4', 'entry-A', 'Nota de A', { offline: false });
    expect(online.result).toMatchObject({ updatedRemotely: true });

    expect(noteOf(remote(), 'R4')).toBe('Nota de A');
    expect(remote().beds.R6.pathology).toBe('Dx E');
    expect(noteOf(await local(), 'R4')).toBe('Nota de A');
    expect((await local()).beds.R6.pathology).toBe('Dx E corregido');
    expect((await queue()).map(task => task.type)).toEqual(['UPDATE_DAILY_RECORD']);

    await reconnect();
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    expect(noteOf(remote(), 'R4')).toBe('Nota de A');
    expect(await queue()).toEqual([]);
  });

  it('syncs two notes on different beds and a day edit, with nothing left behind', async () => {
    const base = day(DATE, { R4: A(), H1C1: C(), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    const first = await writeNote(base, 'R4', 'entry-A', 'Nota de A');
    await writeNote(first.record, 'H1C1', 'entry-C', 'Nota de C');
    await writeDay(await local(), { 'beds.R6.pathology': 'Dx E corregido' });
    await reconnect();

    expect(noteOf(remote(), 'R4')).toBe('Nota de A');
    expect(noteOf(remote(), 'H1C1')).toBe('Nota de C');
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    expect(await queue()).toEqual([]);
    expect(readMedicalHandoffDrafts()).toEqual([]);
    expect(noteOf(await local(), 'H1C1')).toBe('Nota de C');
  });

  it('refuses a second writer of the same note from an older base, keeping the first one', async () => {
    const base = day(DATE, { R4: A() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeNote(base, 'R4', 'entry-A', 'Nota v1');
    const stale = await writeNote(base, 'R4', 'entry-A', 'Nota de otra pestaña').catch(
      error => error
    );
    expect(stale).toMatchObject({ name: 'ConcurrencyError' });
    expect(noteOf(await local(), 'R4')).toBe('Nota v1');
    const [task] = await queue();
    expect(JSON.stringify(task.payload)).toContain('Nota v1');
    expect(JSON.stringify(task.payload)).not.toContain('Nota de otra pestaña');
    expect(noteOf(remote(), 'R4')).toBe('');
    await reconnect();
    expect(noteOf(remote(), 'R4')).toBe('Nota v1');
  });

  it('replays a note whose response was lost once, after a reopen, and only then clears its draft', async () => {
    const base = day(DATE, { R4: A() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    writeMedicalHandoffDraft(createMedicalHandoffDraftWriter(), {
      date: DATE,
      ...buildSpecialistHandoffIdentity(base.beds.R4),
      entryId: 'entry-A',
      value: 'Nota de A',
    });
    h.loseNextResponse = true;
    const lost = await writeNote(base, 'R4', 'entry-A', 'Nota de A', { offline: false });
    expect(lost.result).toMatchObject({ queuedForRetry: true, updatedRemotely: false });
    expect(noteOf(remote(), 'R4')).toBe('Nota de A');
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);

    hospitalDB.close();
    await hospitalDB.open();
    resetMedicalHandoffDraftMemoryForTests();
    await reconnect();
    expect(h.callableCalls).toBe(2);
    expect(noteOf(remote(), 'R4')).toBe('Nota de A');
    expect(await queue()).toEqual([]);
    expect(draftsFor('Paciente A Sintético')).toEqual([]);
    expect(T0).toBe(base.lastUpdated);
  });
});
