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
import { resolveItemId } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import { applyPatches } from '@/utils/patchUtils';
import { hospitalDB, isDatabaseInFallbackMode } from '@/services/storage/indexeddb/indexedDbCore';
import { createFieldChangedElsewhereError } from '@/services/storage/syncErrorCatalog';
import { holdsDailyRecordProjection } from './dexieSyncQueueQuarantine';
import { pathsChangedElsewhere } from './firestoreSyncConflictPolicy';
import { resolveHeldConflictState } from './syncQueueFailurePolicy';
import { clearSyncTaskRuntimeState } from './syncQueueTaskFactory';
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

/** Whether the stored day holds, at a captured field, its base or already the queued value. */
const holdsBaseOrQueuedValue =
  (task: SyncTask, stored: DailyRecord, queued: DailyRecord) =>
  (path: string): boolean => {
    const value = getValueAtPath(stored, path);
    return (
      hasSameComparableValue(value, task.patchBaseValues?.[path]) ||
      hasSameComparableValue(value, getValueAtPath(queued, path))
    );
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
  const holds = holdsBaseOrQueuedValue(task, stored, queued);
  if (!plain.every(path => Object.hasOwn(task.patchBaseValues ?? {}, path) && holds(path)))
    return undefined;
  return {
    ...task,
    syncContract: {
      ...task.syncContract,
      changedPaths: paths.filter(path => !plain.includes(path)),
    },
  };
};

/** The rest of a day write, published without the plain day fields another computer changed. */
export interface PlainDayFieldsHeldOut {
  /** Those fields: they stay held in the day task. */
  paths: string[];
  /**
   * The write without them, under its own mutation id, and its payload rebased on the stored day:
   * the stored values at those fields, and movement lists rebased item by item.
   */
  task: SyncTask;
  record: DailyRecord;
}

/**
 * A day write that also holds plain day fields another computer changed (the stored day holds
 * neither their base nor the queued value) publishes the rest (W12-CW12): different fields keep
 * both edits, and only those fields wait as «El campo cambió en otro equipo» (SAVE-02, SAVE-03).
 * The published part takes its own mutation id, so the server never acknowledges the held fields.
 * Undefined when no plain field changed elsewhere, nothing else is left to publish, or the rest
 * does not rebase cleanly (`rebaseHeldOutPart`): the whole write then waits for review.
 */
export const holdOutPlainDayFieldsChangedElsewhere = (
  task: SyncTask,
  storedData: Record<string, unknown>,
  stored: DailyRecord,
  record: DailyRecord
): PlainDayFieldsHeldOut | undefined => {
  const changedPaths = normalizeChangedPaths(task.syncContract?.changedPaths);
  const holds = holdsBaseOrQueuedValue(task, stored, record);
  const paths = changedPaths.filter(
    path =>
      isPlainDayFieldReplayPath(path) &&
      Object.hasOwn(task.patchBaseValues ?? {}, path) &&
      !holds(path)
  );
  if (
    task.nursingHandoffRecovery ||
    changedPaths.includes('*') ||
    !paths.length ||
    paths.length === changedPaths.length
  )
    return undefined;
  const { mutationIds: _compacted, ...contract } = task.syncContract ?? {};
  const rest: SyncTask = {
    ...task,
    syncContract: {
      ...contract,
      changedPaths: changedPaths.filter(path => !paths.includes(path)),
      mutationId: `${contract.mutationId ?? task.opId}:published-part`,
    },
  };
  const restRecord = applyPatches(
    record,
    Object.fromEntries(paths.map(path => [path, getValueAtPath(stored, path)])) as DailyRecordPatch
  );
  const rebased = rebaseHeldOutPart(
    rest,
    pathsChangedElsewhere(rest, storedData, stored, restRecord, task),
    stored,
    restRecord
  );
  return rebased ? { paths, task: rest, record: rebased } : undefined;
};

const WHOLE_MOVEMENT_LIST_PATH = /^(discharges|transfers|cma)$/;
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * A movement list rebased item by item (by id): each item this computer did not change keeps the
 * stored one, so another computer's correction stays, and each one it changed or added keeps this
 * computer's. Undefined when both changed one item to different values: that waits for review.
 */
const rebaseMovementList = (
  base: unknown,
  queued: unknown,
  stored: unknown
): unknown[] | undefined => {
  const byId = (list: unknown) => new Map(asList(list).map(item => [resolveItemId(item), item]));
  const [before, mine, theirs] = [byId(base), byId(queued), byId(stored)];
  const ids = new Set([...theirs.keys(), ...mine.keys(), ...before.keys()]);
  const rebased: unknown[] = [];
  for (const id of ids) {
    const changedHere = !hasSameComparableValue(mine.get(id), before.get(id));
    const changedThere = !hasSameComparableValue(theirs.get(id), before.get(id));
    if (changedHere && changedThere && !hasSameComparableValue(mine.get(id), theirs.get(id)))
      return undefined;
    const item = changedHere ? mine.get(id) : theirs.get(id);
    if (item !== undefined) rebased.push(item);
  }
  return rebased;
};

/**
 * The rest of a day write, rebased on the stored day as a direct edit meeting a newer version is:
 * only when every field has the base it was written over, no movement list removes an item by
 * absence, and each value the stored day changed meanwhile (`changed`, from
 * `pathsChangedElsewhere`) is a movement list that rebases item by item. Undefined otherwise, and
 * the whole write then waits for review as before.
 */
const rebaseHeldOutPart = (
  task: SyncTask,
  changed: string[],
  stored: DailyRecord,
  record: DailyRecord
): DailyRecord | undefined => {
  const paths = normalizeChangedPaths(task.syncContract?.changedPaths);
  const base = task.patchBaseValues ?? {};
  const version = task.syncContract?.expectedVersion;
  if (
    version === UNKNOWN_SERVER_VERSION ||
    !Number.isFinite(Date.parse(version ?? '')) ||
    !paths.every(path => path !== '*' && Object.hasOwn(base, path))
  )
    return undefined;
  // A movement this computer removed by absence (no `deletedAt`): the merge by id would bring it
  // back once published, and the held task would no longer carry that removal.
  const removesByAbsence = (path: string) => {
    const kept = new Set(asList(getValueAtPath(record, path)).map(resolveItemId));
    return asList(base[path]).some(item => !kept.has(resolveItemId(item)));
  };
  if (paths.some(path => WHOLE_MOVEMENT_LIST_PATH.test(path) && removesByAbsence(path)))
    return undefined;
  const lists: Record<string, unknown[]> = {};
  for (const path of changed) {
    const list = WHOLE_MOVEMENT_LIST_PATH.test(path)
      ? rebaseMovementList(base[path], getValueAtPath(record, path), getValueAtPath(stored, path))
      : undefined;
    if (!list) return undefined;
    lists[path] = list;
  }
  return applyPatches(record, lists as DailyRecordPatch);
};

/**
 * The day task as it stays once the rest of it is published: held with only the fields another
 * computer changed, their unsent text over the committed day, and the remote base they were
 * written over, so the next edit of them meets the other computer's text again.
 */
export const keepPlainDayFieldsHeld = (
  task: SyncTask,
  queued: DailyRecord,
  paths: string[],
  committed: DailyRecord
): Partial<SyncTask> => ({
  ...clearSyncTaskRuntimeState(),
  ...resolveHeldConflictState(createFieldChangedElsewhereError(), task.contexts),
  payload: applyPatches(
    committed,
    Object.fromEntries(paths.map(path => [path, getValueAtPath(queued, path)])) as DailyRecordPatch
  ),
  syncContract: { ...task.syncContract, changedPaths: paths },
  patchBaseValues: Object.fromEntries(paths.map(path => [path, task.patchBaseValues?.[path]])),
  patchBaseRevisions: Object.fromEntries(
    paths.flatMap(path => {
      const revision = task.patchBaseRevisions?.[path];
      return revision === undefined ? [] : [[path, revision]];
    })
  ),
});

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
