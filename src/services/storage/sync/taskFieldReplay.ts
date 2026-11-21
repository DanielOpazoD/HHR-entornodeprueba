import { getDoc } from 'firebase/firestore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncTransportResult } from '@/services/storage/sync/syncQueuePorts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import { docToRecord, getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import {
  isDailyRecordBedTreePath,
  isPlainDayFieldPath,
  STAFFING_PATH,
} from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { isClinicalAuthorityCallablePatchPath } from '@/services/storage/dailyRecordAuthorityContract';
import {
  getValueAtPath,
  hasSameComparableValue,
  normalizeChangedPaths,
} from '@/services/repositories/conflictResolutionUtils';
import { resolveItemId } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { applyPatches } from '@/utils/patchUtils';
import { hospitalDB, isDatabaseInFallbackMode } from '@/services/storage/indexeddb/indexedDbCore';
import { createFieldChangedElsewhereError } from '@/services/storage/syncErrorCatalog';
import { hasSameBedOccupant } from './bedOccupantIdentity';
import { holdsDailyRecordProjection } from './dexieSyncQueueQuarantine';
import { pathsChangedElsewhere } from './firestoreSyncConflictPolicy';
import { resolveHeldConflictState } from './syncQueueFailurePolicy';
import { clearSyncTaskRuntimeState } from './syncQueueTaskFactory';
import { resolveRecordBaseRevision, UNKNOWN_SERVER_VERSION } from './syncTaskContractPolicy';

const MOVEMENT_LIST_PATH = /^(discharges|transfers|cma)(\.|$)/;

// '*' is a whole-day write, never a field.
const isPlainDayFieldReplayPath = (path: string): boolean =>
  path !== '*' && isPlainDayFieldPath(path) && !MOVEMENT_LIST_PATH.test(path);

/** One field of a bed or crib, or a bed's type: never a whole bed or crib. */
const isBedFieldReplayPath = (path: string): boolean => {
  const [root, bedId, field, nested] = path.split('.');
  if (root === 'bedTypeOverrides') return Boolean(bedId) && field === undefined;
  return root === 'beds' && Boolean(bedId && field) && (field !== 'clinicalCrib' || !!nested);
};

/**
 * The changed paths of a queued day write that resends as the same edit made online would save
 * (W22-SAVE-B): each with its captured base and a known server version, and each a day field,
 * staffing or one field of a bed. Undefined for a whole-day write, a movement list, a whole bed or
 * crib, or a field without its base: those keep the whole-day publish.
 */
export const fieldReplayPaths = (task: SyncTask): string[] | undefined => {
  const paths = normalizeChangedPaths(task.syncContract?.changedPaths);
  const base = task.patchBaseValues;
  const version = task.syncContract?.expectedVersion;
  const byField =
    !task.nursingHandoffRecovery &&
    base &&
    version !== UNKNOWN_SERVER_VERSION &&
    Number.isFinite(Date.parse(version ?? '')) &&
    paths.length > 0 &&
    paths.every(
      path =>
        Object.hasOwn(base, path) &&
        (isPlainDayFieldReplayPath(path) || STAFFING_PATH.test(path) || isBedFieldReplayPath(path))
    );
  return byField ? paths : undefined;
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

const IDENTITY_FIELDS = new Set([
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'rut',
  'documentType',
  'clinicalEpisodeId',
]);
/** Values main merges item by item or by specialty: a field write would drop the other side's. */
const MERGED_VALUE_PATH =
  /^(medicalHandoff|beds\.[^.]+\.(clinicalCrib\.)?(medicalHandoffEntries|medicalHandoffNote|medicalHandoffAudit|clinicalEvents)(\.|$))/;

/** The bed or crib whose patient a path names (`beds.R1`, `beds.R1.clinicalCrib`), if it does. */
const identitySlotOf = (path: string): string | undefined => {
  const [root, bedId, field, nested] = path.split('.');
  if (root !== 'beds' || !bedId) return undefined;
  if (field === 'clinicalCrib')
    return IDENTITY_FIELDS.has(nested ?? '') ? `beds.${bedId}.clinicalCrib` : undefined;
  return IDENTITY_FIELDS.has(field ?? '') ? `beds.${bedId}` : undefined;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Whether writing `next` field by field (the write flattens a map into its keys) leaves the same
 * value as replacing `previous` whole: no key of `previous` with a value is missing in `next`. A
 * renamed device key, for one, is not.
 */
const keepsEveryKey = (next: unknown, previous: unknown): boolean =>
  !isPlainObject(previous) ||
  !isPlainObject(next) ||
  Object.entries(previous).every(
    ([key, value]) =>
      value === null ||
      value === undefined ||
      (Object.hasOwn(next, key) && keepsEveryKey(next[key], value))
  );

/**
 * Whether these fields resend as the same edit made online (W22-SAVE-B, after its review): each
 * value is replaced whole (a scalar, a list or a map that loses no key), none is merged item by
 * item in main (handoff entries and notes), the bed fields are of one route (structural or
 * clinical, a single authority write), and staffing never goes with a bed field (its write needs
 * the exact version the bed write moves). An edit of who a bed or crib holds goes on only as an
 * admission: that slot was empty when the edit was written (`patchBaseContext`) and still is
 * (ID-01). Otherwise the task keeps the whole-day publish, as in main.
 */
export const canReplayByField = (
  task: SyncTask,
  paths: string[],
  queued: DailyRecord,
  stored: DailyRecord
): boolean => {
  const context = task.patchBaseContext;
  const bedPaths = paths.filter(isDailyRecordBedTreePath);
  const clinical = bedPaths.filter(isClinicalAuthorityCallablePatchPath).length;
  if (clinical > 0 && clinical < bedPaths.length) return false;
  if (bedPaths.length && paths.some(path => STAFFING_PATH.test(path))) return false;
  const emptyAt = (slot: string, source: (field: string) => unknown) =>
    hasSameBedOccupant(
      Object.fromEntries(
        [...IDENTITY_FIELDS].map(field => [field, source(field)])
      ) as Partial<PatientData> as PatientData,
      undefined
    );
  return paths.every(path => {
    const value = getValueAtPath(queued, path);
    if (MERGED_VALUE_PATH.test(path)) return false;
    if (
      !keepsEveryKey(value, getValueAtPath(stored, path)) ||
      !keepsEveryKey(value, task.patchBaseValues?.[path])
    )
      return false;
    const slot = identitySlotOf(path);
    return (
      !slot ||
      Boolean(
        context &&
        emptyAt(slot, field => context[`${slot}.${field}`]) &&
        emptyAt(slot, field => getValueAtPath(stored, `${slot}.${field}`))
      )
    );
  });
};

const valuesAt = (source: DailyRecord, paths: string[]): DailyRecordPatch =>
  Object.fromEntries(paths.map(path => [path, getValueAtPath(source, path)])) as DailyRecordPatch;

/**
 * Resends these fields of a queued day write as the same edit made online saves them (W22-SAVE-B),
 * once `canReplayByField` admits them. The replay has just checked each field against its base in
 * `storedData`, and every write is made over that same read, never over a version a write of this
 * task returned: first the bed fields, through the authority patch on that read's time and
 * revision, with the fields a normal save derives from them on that patient (name parts, episode,
 * FHIR); then the day fields and staffing, through their direct write, whose transaction accepts
 * a newer version only while each field still holds that read's value or the queued one. A day
 * that changed in between refuses the write and the task stays as it is. Only a last write carries
 * the task's mutation id, so an earlier part never acknowledges the rest; a part already stored
 * is recognized next time by its stored value. A changed owner or session generation stops every
 * write (no write, no notice).
 */
export const replayTaskFields = async (
  task: SyncTask,
  record: DailyRecord,
  paths: string[],
  storedData: Record<string, unknown>,
  runtime: FirestoreServiceRuntimePort,
  assertCanPublish?: () => void
): Promise<SyncTransportResult> => {
  const { date } = record;
  const stored = docToRecord(storedData, date);
  const bedPaths = paths.filter(isDailyRecordBedTreePath);
  const dayPaths = paths.filter(path => !isDailyRecordBedTreePath(path));
  const slotOf = (path: string) => path.split('.').slice(0, 2).join('.');
  const slots = new Set(bedPaths.map(slotOf));
  const bedPatch = Object.fromEntries(
    Object.entries(
      bedPaths.length
        ? preparePatchedRecordPersistence(stored, date, valuesAt(record, bedPaths)).mergedPatches
        : {}
    ).filter(([path]) => isBedFieldReplayPath(path) && slots.has(slotOf(path)))
  ) as DailyRecordPatch;
  const parts = [bedPatch, valuesAt(record, dayPaths)].filter(part => Object.keys(part).length > 0);
  const mutationId = task.syncContract?.mutationId ?? task.opId;
  let receipt: Awaited<ReturnType<typeof updateRecordPartial>> | undefined;
  for (const [index, part] of parts.entries()) {
    const last = index === parts.length - 1;
    receipt = await updateRecordPartial(date, part, stored.lastUpdated, {
      baseRecord: stored,
      syncContract: {
        ...task.syncContract,
        changedPaths: Object.keys(part).filter(path => paths.includes(path)),
        expectedVersion: stored.lastUpdated,
        baseRevision: resolveRecordBaseRevision(stored),
        mutationId: last ? mutationId : `${mutationId}:part-${index}`,
        mutationIds: last ? task.syncContract?.mutationIds : undefined,
      },
      returnCommittedRecord: true,
      assertCanPublish,
    });
  }
  // Without a projectable receipt, the stored day after the commit is the committed record.
  return {
    authoritativeRecord:
      receipt?.recordState?.record ??
      docToRecord((await getDoc(getRecordDocRef(date, runtime))).data() ?? {}, date),
  };
};
