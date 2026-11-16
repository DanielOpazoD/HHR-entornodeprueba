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
 * A direct edit of plain day fields that a day write of this computer still holds unsent is
 * checked as that write's replay will be: against the values and version the server had when it
 * was made, not against the day shown here, which keeps the unsent text. So a text another
 * computer saved meanwhile is met again, even after a «changed elsewhere» notice, and this
 * computer's own unsent text is not mistaken for someone else's (SAVE-02). Undefined when no
 * unsent write of the day changes these fields.
 */
export const resolveUnsentPlainDayFieldBase = async (
  date: string,
  shown: DailyRecord,
  paths: string[]
): Promise<{ baseRecord: DailyRecord; expectedVersion: string } | undefined> => {
  if (!paths.length || !paths.every(isPlainDayFieldReplayPath) || isDatabaseInFallbackMode())
    return undefined;
  const values = new Map<string, unknown>();
  const versions = new Set<string>();
  for (const task of await hospitalDB.syncQueue.where('key').equals(`daily:${date}`).toArray()) {
    const replayed = holdsDailyRecordProjection(task, date) && plainDayFieldReplayPaths(task);
    if (!replayed) continue;
    for (const path of paths)
      if (replayed.includes(path) && !values.has(path)) {
        values.set(path, task.patchBaseValues?.[path]);
        versions.add(task.syncContract?.expectedVersion ?? UNKNOWN_SERVER_VERSION);
      }
  }
  if (!values.size) return undefined;
  return {
    baseRecord: applyPatches(shown, Object.fromEntries(values) as DailyRecordPatch),
    // Two writes made over different versions: only the field check decides.
    expectedVersion: versions.size === 1 ? [...versions][0] : UNKNOWN_SERVER_VERSION,
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
