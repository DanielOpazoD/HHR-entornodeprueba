import { captureAuthoringSession } from '@/services/storage/authoringSession';
/**
 * Synthetic-only helpers for a census day edited offline while another session writes it. The
 * device clock moves forward between the read (T0, 10:00), the other session's write (10:15) and
 * the census edit (10:45).
 */
import { expect, vi } from 'vitest';
import { T0, clone, day, harnessState } from './dayRecordOutboxHarness';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  saveDetailed,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import type { DailyRecord, DailyRecordPatch } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { asStoredDailyRecordShape } from '@/tests/factories/DataFactory';

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
export const remote = () => asStoredDailyRecordShape(h.remote);
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

export const resetDay = async (owner: string) => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', owner);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  h.offline = false;
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
export const saveWholeDay = (
  record: DailyRecord,
  when = '2026-10-24T10:46:00.000Z',
  baseRecord?: DailyRecord
) =>
  at(when, async () => {
    h.offline = true;
    try {
      return await saveDetailed(record, record.lastUpdated, {
        authoringSession: captureAuthoringSession(),
        baseRecord,
      });
    } finally {
      h.offline = false;
    }
  });

/** A census edit, offline: it goes through the day task. */
export const writeDay = (
  patch: Record<string, unknown>,
  when = '2026-10-24T10:45:00.000Z',
  baseRecord?: DailyRecord
) =>
  at(when, async () => {
    h.offline = true;
    try {
      return await updatePartialDetailed(DATE, patch as DailyRecordPatch, {
        authoringSession: captureAuthoringSession(),
        baseRecord: baseRecord ?? (await local()),
      });
    } finally {
      h.offline = false;
    }
  });

/** The other session's patient B is still in R4. */
export const expectBInR4 = () =>
  expect(remote().beds.R4).toMatchObject({
    patientName: 'Paciente B Sintético',
    clinicalEpisodeId: 'ep-B',
  });

/** Asserts publication or queued retention, as requested by the case. */
export const expectDayEditsPublishedOrKept = async (
  keepQueued: boolean,
  edits: Record<string, unknown>
) => {
  const tasks = await dayTasks();
  if (!keepQueued) {
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
