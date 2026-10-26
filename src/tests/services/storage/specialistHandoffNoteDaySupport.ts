/**
 * Synthetic-only helpers for a specialist note queued offline on a day that later gets a census
 * edit, while another session replaces a patient. The device clock moves forward between the read
 * (T0, 10:00), the other session's write (10:15), the note (10:30) and the census edit (10:45).
 */
import { expect, vi } from 'vitest';
import {
  T0,
  clone,
  createServerHandler,
  day,
  draftsFor,
  harnessState,
  writeNote,
} from './specialistHandoffOutboxHarness';
import { hospitalDB } from '@/services/storage/indexedDBService';
import {
  saveDetailed,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { shouldRouteSpecialistPatchViaCallable } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { buildMedicalEntryNoteFields } from '@/domain/handoff/patientEntryMutations';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import type { DailyRecord, DailyRecordPatch } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const h = harnessState();
export const DATE = '2026-10-24';
/** The other session's write, which this offline device has not read. */
export const B_AT = '2026-10-24T10:15:00.000Z';
/** Both publication modes; `enforced` is the release mode. */
export const MODES = [
  ['client_only', false],
  ['enforced', true],
] as const;

export const local = async () => (await hospitalDB.dailyRecords.get(DATE)) as DailyRecord;
export const remote = () => h.remote as unknown as DailyRecord;
export const queue = () => hospitalDB.syncQueue.toArray();
export const dayTasks = async () => (await queue()).filter(task => task.key === `daily:${DATE}`);

/** Runs with the device clock at `iso`. */
export const at = async <T>(iso: string, run: () => Promise<T>): Promise<T> => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
};

export const resetNoteDay = async (owner: string) => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  resetMedicalHandoffDraftMemoryForTests();
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', owner);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  h.handler = createServerHandler();
  h.role = 'admin';
  h.offline = false;
  h.loseNextResponse = false;
  h.authorityMode = false;
};

const withMeta = (record: DailyRecord, meta?: Record<string, unknown>) =>
  (meta ? { ...record, meta } : record) as DailyRecord;

/** Firestore holds `beds`, and this device read them. */
export const readStored = async (
  beds: Record<string, PatientData>,
  lastUpdated = T0,
  meta?: Record<string, unknown>
) => {
  h.remote = withMeta(day(DATE, beds, lastUpdated), meta);
  const read = docToRecord(clone(h.remote) as never, DATE);
  await hospitalDB.dailyRecords.put(read);
  return read;
};

/** Another session writes the day; this device has not read it. */
export const remoteWrite = (
  beds: Record<string, PatientData>,
  lastUpdated: string,
  meta?: Record<string, unknown>
) => {
  h.remote = withMeta(day(DATE, beds, lastUpdated), meta);
};

/** A whole-record save, offline, as the census view saves the record it shows. */
export const saveWholeDay = (record: DailyRecord, when = '2026-10-24T10:46:00.000Z') =>
  at(when, async () => {
    h.offline = true;
    try {
      return await saveDetailed(record, record.lastUpdated);
    } finally {
      h.offline = false;
    }
  });

/** As a device updated from #1026 keeps a note: no record of its projection, day at its time. */
export const asQueuedBeforeFix = async (status?: 'CONFLICT') => {
  for (const task of (await queue()).filter(item => item.type === 'UPDATE_SPECIALIST_HANDOFF'))
    await hospitalDB.syncQueue.update(task.id!, {
      handoffProjection: undefined,
      ...(status ? { status, lastErrorCode: 'synthetic_refused_before_fix' } : {}),
    });
  const stored = await local();
  await hospitalDB.dailyRecords.put({ ...stored, lastUpdated: '2026-10-24T10:30:00.000Z' });
};

/** A census edit, offline: it goes through the day task. */
export const writeDay = (
  patch: Record<string, unknown>,
  when = '2026-10-24T10:45:00.000Z',
  baseRecord?: DailyRecord
) =>
  at(when, async () => {
    vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(false);
    h.offline = true;
    try {
      return await updatePartialDetailed(DATE, patch as DailyRecordPatch, {
        baseRecord: baseRecord ?? (await local()),
      });
    } finally {
      h.offline = false;
      vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(true);
    }
  });

/** A specialist note on the bed's patient, offline unless said otherwise. */
export const note = (
  bedId: string,
  entryId: string,
  text: string,
  when = '2026-10-24T10:30:00.000Z',
  offline = true
) => at(when, async () => writeNote(await local(), bedId, entryId, text, { offline }));

/** A specialist note on the newborn in the bed's crib, offline. */
export const cribNote = (bedId: string, entryId: string, text: string) =>
  at('2026-10-24T10:30:00.000Z', async () => {
    const record = await local();
    const crib = record.beds[bedId].clinicalCrib as PatientData;
    const { fields } = buildMedicalEntryNoteFields(crib, entryId, text, null, record.date, T0);
    h.offline = true;
    try {
      return await updatePartialDetailed(
        record.date,
        Object.fromEntries(
          Object.entries(fields).map(([field, value]) => [
            `beds.${bedId}.clinicalCrib.${field}`,
            value,
          ])
        ) as DailyRecordPatch,
        { baseRecord: record }
      );
    } finally {
      h.offline = false;
    }
  });

/** The other session's patient B is still in R4, without the note written for A. */
export const expectBInR4 = () =>
  expect(remote().beds.R4).toMatchObject({
    patientName: 'Paciente B Sintético',
    clinicalEpisodeId: 'ep-B',
    medicalHandoffNote: '',
  });

/** The refused note stays a CONFLICT task, and its text a draft of its own patient. */
export const expectRefusedNoteKept = async (
  name = 'Paciente A Sintético',
  entryId = 'entry-A',
  text = 'Nota de A'
) => {
  const notes = (await queue()).filter(task => task.type === 'UPDATE_SPECIALIST_HANDOFF');
  expect(notes.map(task => task.status)).toEqual(['CONFLICT']);
  expect(draftsFor(name)).toEqual([[DATE, entryId, text]]);
};

/**
 * A day write whose base is older than the stored day: client_only merges its changes onto that
 * day; enforced keeps it queued, since the authority refuses an older base. Held, never lost.
 */
export const expectDayEditsPublishedOrKept = async (
  enforced: boolean,
  edits: Record<string, unknown>
) => {
  const tasks = await dayTasks();
  if (!enforced) {
    for (const [path, value] of Object.entries(edits))
      expect(getValueAtPath(remote(), path)).toEqual(value);
    expect(tasks).toEqual([]);
    return;
  }
  expect(tasks).toHaveLength(1);
  expect(['PENDING', 'CONFLICT']).toContain(tasks[0].status);
  for (const [path, value] of Object.entries(edits)) {
    expect(getValueAtPath(tasks[0].payload, path)).toEqual(value);
    expect(getValueAtPath(remote(), path)).not.toEqual(value);
  }
};
