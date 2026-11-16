import { getDoc } from 'firebase/firestore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncTransportResult } from '@/services/storage/sync/syncQueuePorts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { docToRecord, getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { isPlainDayFieldPath } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import {
  getValueAtPath,
  hasSameComparableValue,
  normalizeChangedPaths,
} from '@/services/repositories/conflictResolutionUtils';
import { applyPatches } from '@/utils/patchUtils';
import { hospitalDB, isDatabaseInFallbackMode } from '@/services/storage/indexeddb/indexedDbCore';
import { holdsDailyRecordProjection } from './dexieSyncQueueQuarantine';
import { UNKNOWN_SERVER_VERSION } from './syncTaskContractPolicy';

const MOVEMENT_LIST_PATH = /^(discharges|transfers|cma)(\.|$)/;

// '*' is a whole-day write, never a field.
const isPlainDayFieldReplayPath = (path: string): boolean =>
  path !== '*' && isPlainDayFieldPath(path) && !MOVEMENT_LIST_PATH.test(path);

/**
 * The changed paths of a day write of plain fields only, each with its captured base and a known
 * server version: no bed, staffing or movement list, which keep their own version checks. A
 * direct edit of these fields commits through updateRecordPartial, and so does their replay.
 */
export const plainDayFieldReplayPaths = (task: SyncTask): string[] | undefined => {
  const paths = normalizeChangedPaths(task.syncContract?.changedPaths);
  const base = task.patchBaseValues;
  const version = task.syncContract?.expectedVersion;
  const plain =
    !task.nursingHandoffRecovery &&
    base &&
    version !== UNKNOWN_SERVER_VERSION &&
    Number.isFinite(Date.parse(version ?? '')) &&
    paths.length > 0 &&
    paths.every(path => isPlainDayFieldReplayPath(path) && Object.hasOwn(base, path));
  return plain ? paths : undefined;
};

/**
 * A day write that also holds a bed's diagnosis or status, both unsent edits of this computer, is
 * rebased as each part alone would be: its plain day fields must still hold, in the stored day,
 * their base or already the queued value, and the rest keeps its own check. The write without
 * those plain fields, or undefined when another computer changed one of them.
 */
export const withoutUnchangedPlainDayFields = (
  task: SyncTask,
  stored: DailyRecord,
  queued: DailyRecord
): SyncTask | undefined => {
  const paths = normalizeChangedPaths(task.syncContract?.changedPaths);
  const plain = paths.filter(isPlainDayFieldReplayPath);
  const base = task.patchBaseValues ?? {};
  const unchanged = plain.every(path => {
    const value = getValueAtPath(stored, path);
    return (
      Object.hasOwn(base, path) &&
      (hasSameComparableValue(value, base[path]) ||
        hasSameComparableValue(value, getValueAtPath(queued, path)))
    );
  });
  if (!unchanged) return undefined;
  return {
    ...task,
    syncContract: {
      ...task.syncContract,
      changedPaths: paths.filter(path => !plain.includes(path)),
    },
  };
};

/**
 * The server instant a direct edit of this day is checked against while a day write of this
 * computer is still unsent: the local day then carries that write's local time, or the server's
 * version over a value the server does not hold, and neither is a version of the server (SAVE-02).
 * The edit takes the version those writes were made on, and, for each field one of them holds,
 * the value the server had then. A field another computer changed meanwhile is met again, even
 * after a «changed elsewhere» notice, and this computer's own unsent text is not mistaken for
 * someone else's. Undefined when no unsent write holds the day.
 */
export const resolveUnsentDayBase = async (
  date: string,
  shown: DailyRecord,
  paths: string[]
): Promise<{ baseRecord: DailyRecord; expectedVersion: string } | undefined> => {
  if (!paths.length || isDatabaseInFallbackMode()) return undefined;
  const values = new Map<string, unknown>();
  let version: string | undefined;
  for (const task of await hospitalDB.syncQueue.where('key').equals(`daily:${date}`).toArray()) {
    if (!holdsDailyRecordProjection(task, date)) continue;
    const taskVersion = task.syncContract?.expectedVersion;
    // Writes made over different versions: only the field check decides.
    version =
      version === undefined || version === taskVersion
        ? (taskVersion ?? UNKNOWN_SERVER_VERSION)
        : UNKNOWN_SERVER_VERSION;
    const held = normalizeChangedPaths(task.syncContract?.changedPaths);
    for (const path of paths)
      if (held.includes(path) && Object.hasOwn(task.patchBaseValues ?? {}, path))
        if (!values.has(path)) values.set(path, task.patchBaseValues?.[path]);
  }
  if (version === undefined) return undefined;
  return {
    baseRecord: applyPatches(shown, Object.fromEntries(values) as DailyRecordPatch),
    expectedVersion: version,
  };
};

/**
 * The same write as a direct edit of these fields (SAVE-02): inside its transaction, a newer
 * version is refused only when one of them holds neither its base nor the queued value, and that
 * refusal leaves the task whole as a conflict. `record` already carries the server's own text for
 * the fields it held as wanted.
 */
export const replayPlainDayFields = async (
  task: SyncTask,
  record: DailyRecord,
  paths: string[],
  runtime: FirestoreServiceRuntimePort,
  assertCanPublish?: () => void
): Promise<SyncTransportResult> => {
  const base = new Map(Object.entries(task.patchBaseValues ?? {}));
  const patchAt = (valueAt: (path: string) => unknown) =>
    Object.fromEntries(paths.map(path => [path, valueAt(path)])) as DailyRecordPatch;
  const receipt = await updateRecordPartial(
    record.date,
    patchAt(path => getValueAtPath(record, path)),
    task.syncContract?.expectedVersion,
    {
      // Only these fields' base values matter to the check.
      baseRecord: applyPatches(
        record,
        patchAt(path => base.get(path))
      ),
      syncContract: task.syncContract,
      returnCommittedRecord: true,
      // A changed owner or session generation stops the write at every step (no write, no notice).
      assertCanPublish,
    }
  );
  // Without a projectable receipt, the stored day after the commit is the committed record.
  return {
    authoritativeRecord:
      receipt?.recordState?.record ??
      docToRecord((await getDoc(getRecordDocRef(record.date, runtime))).data() ?? {}, record.date),
  };
};
