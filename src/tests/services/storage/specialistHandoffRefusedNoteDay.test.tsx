/**
 * Synthetic-only: once a specialist note written offline is refused or discarded, its projection
 * stops shaping the day. The next read takes the server's day, a later census edit publishes in
 * both modes and never writes the departed patient back, and the note text stays recoverable.
 * Also covers a note and a census edit queued before this rule, on a device that kept them.
 */
import 'fake-indexeddb/auto';
import { A, B, E, day, draftsFor, harnessState, reconnect } from './specialistHandoffOutboxHarness';
import {
  B_AT,
  DATE,
  MODES,
  dayTasks,
  expectBInR4,
  expectDayEditsPublishedOrKept,
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
import { hospitalDB } from '@/services/storage/indexedDBService';
import { syncWithFirestoreDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { discardQuarantinedSyncTask } from '@/services/storage/sync';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const h = harnessState();

beforeEach(() => resetNoteDay('user:synthetic-refused-note'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(MODES)('a refused note no longer shapes the day (%s)', (_mode, enforced) => {
  const replay = async () => {
    h.authorityMode = enforced;
    await reconnect();
  };
  /** A note for A, refused because another session put B in R4. */
  const refusedNote = async () => {
    await readStored({ R4: A('R4'), R6: E() });
    await note('R4', 'entry-A', 'Nota de A');
    h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);
    await replay();
    await expectRefusedNoteKept();
  };
  const readDay = async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    return (await syncWithFirestoreDetailed(DATE))!;
  };

  it('reads B after the refused note is discarded, and a later edit never writes A over B', async () => {
    await refusedNote();
    const read = await readDay();
    expect(read.record?.beds.R4).toMatchObject({ patientName: 'Paciente B Sintético' });
    expect((await local()).beds.R4.patientName).toBe('Paciente B Sintético');
    const [refused] = await queue();
    expect(await discardQuarantinedSyncTask(refused.id!)).toBe(true);

    await writeDay(
      { 'beds.R6.pathology': 'Dx E corregido' },
      '2026-10-24T10:50:00.000Z',
      read.record!
    );
    await replay();

    expectBInR4();
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    expect(await queue()).toEqual([]);
  });

  it('publishes a later edit from the refreshed day while the refused note stays a conflict', async () => {
    await refusedNote();
    h.remote = day(DATE, { R4: B(), R6: E() }, '2026-10-24T11:00:00.000Z');
    await readDay();
    expect((await local()).lastUpdated).toBe('2026-10-24T11:00:00.000Z');

    await writeDay({ 'beds.R6.pathology': 'Dx E corregido' }, '2026-10-24T11:10:00.000Z');
    await replay();

    expectBInR4();
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    expect(await dayTasks()).toEqual([]);
    await expectRefusedNoteKept();
  });

  it('never publishes a note refused while its patient stayed, through a later edit', async () => {
    await readStored({ R4: A('R4'), R6: E() });
    await note('R4', 'entry-A', 'Nota de A');
    // Specialists write only the current clinical day; this day is already closed for them.
    h.role = 'doctor_specialist';
    await replay();
    h.role = 'admin';
    await expectRefusedNoteKept();
    expect((await local()).beds.R4.medicalHandoffNote).toBe('');

    await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
    await replay();

    expect(remote().beds.R4).toMatchObject({ patientName: 'Paciente A Sintético' });
    expect(JSON.stringify(remote().beds.R4)).not.toContain('Nota de A');
    expect(remote().beds.R6.pathology).toBe('Dx E corregido');
    expect(await dayTasks()).toEqual([]);
    await expectRefusedNoteKept();
  });

  /** As a device updated from #1026 keeps them: the day moved to the note's local time. */
  const queuedBeforeThisRule = async () => {
    const [noteTask] = await queue();
    await hospitalDB.syncQueue.update(noteTask.id!, { handoffProjection: undefined });
    const stored = await local();
    await hospitalDB.dailyRecords.put({ ...stored, lastUpdated: '2026-10-24T10:30:00.000Z' });
  };

  it('keeps B for a note and an edit queued before this rule, once the note is refused', async () => {
    await readStored({ R4: A('R4'), R6: E() });
    await note('R4', 'entry-A', 'Nota de A');
    await queuedBeforeThisRule();
    await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
    expect((await dayTasks()).map(task => task.syncContract?.expectedVersion)).toEqual([
      '2026-10-24T10:30:00.000Z',
    ]);
    h.remote = day(DATE, { R4: B(), R6: E() }, B_AT);

    await replay();

    expectBInR4();
    await expectDayEditsPublishedOrKept(enforced, { 'beds.R6.pathology': 'Dx E corregido' });
    await expectRefusedNoteKept();
  });

  it('keeps B for an edit queued before this rule after its note was already refused', async () => {
    await refusedNote();
    const stored = await local();
    // The device still shows A with the note, at the note's local time, as #1026 left it.
    await hospitalDB.dailyRecords.put({
      ...stored,
      beds: { ...stored.beds, R4: { ...A('R4'), medicalHandoffNote: 'Nota de A' } },
      lastUpdated: '2026-10-24T10:30:00.000Z',
    } as DailyRecord);
    await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });

    await replay();

    expectBInR4();
    // The legacy projection's timestamp was never a remote base. Keep the accepted edit
    // quarantined under authority instead of adopting a later read as its original version.
    await expectDayEditsPublishedOrKept(enforced, { 'beds.R6.pathology': 'Dx E corregido' });
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
  });
});
