import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import type { DailyRecordPatchWrite } from '@/services/storage/sync/syncQueuePorts';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import type { PatientData } from '@/types/domain/patient';
import { specialistHandoffTextState } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { hasSameBedOccupant } from '@/services/storage/sync/bedOccupantIdentity';
// The replay-time occupant checks ship with the enqueue-time one, in this lazy chunk.
export { detachStaleOccupantPaths } from '@/services/storage/sync/dayTaskOccupantDetach';
export {
  hasOtherOccupantInUntouchedBed,
  keepStoredNoteFields,
} from '@/services/storage/sync/dayTaskReplayGuard';
import { mergeMovementArrayById } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import { mergeRayenSyncHistory } from '@/services/repositories/dailyRecordRayenSyncHistoryPolicy';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { UNKNOWN_SERVER_VERSION } from '@/services/storage/sync/syncTaskContractPolicy';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { applyPatches } from '@/utils/patchUtils';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  findReusableSyncTask,
  listUnresolvedDailyRecordTasks,
  matchesOwner,
} from '@/services/storage/sync/dexieSyncQueueQuarantine';
import {
  buildDailyRecordSyncContract,
  mergeSyncTaskContracts,
} from '@/services/storage/sync/syncTaskContractPolicy';

/** A detached note's text is also offered as drafts in the handoff view. */
export const publishDetachedNotes = async (notes: SpecialistHandoffSyncPayload) =>
  (await import('@/services/storage/medicalHandoffDraftStorage')).publishSpecialistHandoffConflict(
    notes
  );

/**
 * A day's pending truth is its local projection plus the unresolved write that holds it. A write
 * computed from another base must land on top of that projection: its changed paths take its
 * values and every other pending path keeps the value another accepted write gave it.
 * The outbox store loads this module on demand, so it stays off the authenticated startup shell.
 */

type PendingProjectionRebase = (projection: DailyRecord, pendingPaths: string[]) => DailyRecord;

// Same mergeable roots as the publish-time same-path check (firestoreSyncConflictPolicy).
const MOVEMENT_LOG_PATHS = new Set(['discharges', 'transfers', 'cma']);
const BED_SLOT_FIELDS = new Set(['isBlocked', 'blockedReason']);
const BED_FIELD_PATH = /^beds\.([^.]+)(?:\.([^.]+))?/;

/** A legacy or whole-record write does not say which paths it owns. */
const isOpaqueChangedPaths = (paths: readonly string[]): boolean =>
  paths.length === 0 || paths.includes('*');

/** Cache hydration can materialize an absent optional field without creating an edit. */
const isEmptyPatchBaseValue = (value: unknown): boolean =>
  value == null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 0);

const hasSamePatchBaseValue = (left: unknown, right: unknown): boolean =>
  hasSameComparableValue(left, right) ||
  (isEmptyPatchBaseValue(left) && isEmptyPatchBaseValue(right));

/** A field edit belongs to the occupant it was written for; a whole-bed value compares by value. */
const assertSameOccupantAtPath = (
  path: string,
  writtenFor: DailyRecord,
  projection: DailyRecord
): void => {
  const match = BED_FIELD_PATH.exec(path);
  if (!match || BED_SLOT_FIELDS.has(match[2])) return;
  const [, bedId, field] = match;
  const writtenBed = writtenFor.beds?.[bedId];
  const projectedBed = projection.beds?.[bedId];
  if (
    hasSameBedOccupant(writtenBed, projectedBed) &&
    ((field && field !== 'clinicalCrib') ||
      hasSameBedOccupant(writtenBed?.clinicalCrib, projectedBed?.clinicalCrib))
  ) {
    return;
  }
  throw new ConcurrencyError(
    'La cama o la cuna cambió de paciente en otra pestaña. Recargue el censo antes de continuar.'
  );
};

/** Journals keep concurrent ids; a Rayen entry changes only against its writer's base. */
const mergeJournalValue = (
  path: string,
  value: unknown,
  projected: unknown,
  base?: unknown
): unknown[] | null => {
  if (
    path === 'rayenSyncHistory' &&
    Array.isArray(value) &&
    (projected == null || Array.isArray(projected))
  ) {
    const current = projected as DailyRecord['rayenSyncHistory'];
    const currentById = new Map((current ?? []).map(event => [event.id, event]));
    const baseById = new Map(
      (Array.isArray(base) ? (base as RayenSyncEvent[]) : []).map(event => [event.id, event])
    );
    const incomingById = new Map((value as RayenSyncEvent[]).map(event => [event.id, event]));
    const changed = Array.from(incomingById.values()).filter(event => {
      const previous = baseById.get(event.id);
      if (hasSameComparableValue(event, previous)) return false;
      const stored = currentById.get(event.id);
      if (!hasSameComparableValue(stored, previous) && !hasSameComparableValue(stored, event)) {
        throw new ConcurrencyError(
          'Otra pestaña cambió la misma corrida Rayen. Recargue el censo antes de continuar.'
        );
      }
      return true;
    });
    return mergeRayenSyncHistory(current, changed);
  }
  return MOVEMENT_LOG_PATHS.has(path) && Array.isArray(value) && Array.isArray(projected)
    ? mergeMovementArrayById(projected, value, true)
    : null;
};

/**
 * Default for a record queued without its base (a retry or an auto-merge of a write that already
 * reached the outbox): its changed paths are that write's latest intent.
 */
const buildRecordOverlayRebase = (
  record: DailyRecord,
  changedPaths: readonly string[] | undefined,
  isRemoteMerge: boolean
): PendingProjectionRebase | undefined => {
  const ownPaths = (changedPaths ?? []).filter(Boolean);
  if (isOpaqueChangedPaths(ownPaths)) return undefined;
  return (projection, pendingPaths) => {
    let base = projection;
    if (isRemoteMerge) {
      // This record already resolved a remote conflict. Retain remote fields except
      // where an unresolved accepted write explicitly owns a pending local value.
      if (pendingPaths.includes('*')) {
        throw new ConcurrencyError(
          'No se puede reconciliar una escritura pendiente sin sus rutas.'
        );
      }
      const pendingPatch: DailyRecordPatch = {};
      pendingPaths.forEach(path => {
        assertSameOccupantAtPath(path, projection, record);
        const value = getValueAtPath(projection, path);
        pendingPatch[path] = mergeJournalValue(path, value, getValueAtPath(record, path)) ?? value;
      });
      base = applyPatches(record, pendingPatch);
    }
    const patch: DailyRecordPatch = {};
    ownPaths.forEach(path => {
      assertSameOccupantAtPath(path, record, projection);
      const value = getValueAtPath(record, path);
      patch[path] = mergeJournalValue(path, value, getValueAtPath(base, path)) ?? value;
    });
    return { ...applyPatches(base, patch), lastUpdated: record.lastUpdated };
  };
};

/**
 * A new patch and the record it was computed from. When another accepted write already changed
 * the day's pending projection (another tab, or a read that showed an older copy), the patch is
 * prepared again on top of that projection. A path both writes changed follows the conflict
 * policy, not last-write-wins: append-only journals merge by id, anything else is rejected.
 */
const buildPatchRebase =
  ({ baseRecord, patch, prepare }: DailyRecordPatchWrite): PendingProjectionRebase =>
  projection => {
    // Normalize the optimistic base just as persistence does before comparing its values.
    const storedBase = prepare(baseRecord, {});
    const storedProjection = prepare(projection, {});
    const rebasedPatch: DailyRecordPatch = {};
    Object.entries(patch).forEach(([path, value]) => {
      assertSameOccupantAtPath(path, storedBase, storedProjection);
      const projected = getValueAtPath(storedProjection, path);
      if (
        hasSamePatchBaseValue(getValueAtPath(storedBase, path), projected) ||
        hasSameComparableValue(value, projected)
      ) {
        rebasedPatch[path] = value;
        return;
      }
      const merged = mergeJournalValue(path, value, projected, getValueAtPath(storedBase, path));
      if (!merged) {
        throw new ConcurrencyError(
          'Otra pestaña cambió el mismo dato del censo. Recargue el censo antes de continuar.'
        );
      }
      rebasedPatch[path] = merged;
    });
    return prepare(projection, rebasedPatch);
  };

/**
 * The outbox task one write leaves for the day. When an unresolved write still holds the stored
 * projection as its payload, the write lands on that projection and keeps that write's remote base.
 */
const foldWriteIntoOutbox = ({
  task,
  existing,
  stored,
  unresolved,
  rebase,
}: {
  task: SyncTask;
  existing: SyncTask | null;
  stored: DailyRecord | undefined;
  unresolved: SyncTask[];
  rebase: PendingProjectionRebase | undefined;
}): SyncTask => {
  const owner = unresolved.find(
    candidate => stored && hasSameComparableValue(candidate.payload, stored)
  );
  // A published replacement has no pending task, but its content and patient still own the day.
  const pendingPaths = Array.from(
    new Set(
      unresolved.flatMap(candidate =>
        candidate.syncContract?.changedPaths?.length ? candidate.syncContract.changedPaths : ['*']
      )
    )
  );
  const rebased = stored && rebase ? rebase(stored, pendingPaths) : null;
  const merged = mergeSyncTaskContracts(existing?.syncContract, task.syncContract);
  const payload = rebased ?? (task.payload as DailyRecord);
  const baseContract = existing?.syncContract ?? owner?.syncContract;
  return {
    ...task,
    payload,
    syncContract: {
      ...buildDailyRecordSyncContract(payload, merged),
      // A local edit is not a publication. Compaction keeps the unresolved remote base,
      // including an absent revision, even when the next write already carries the projection.
      ...(baseContract
        ? {
            expectedVersion: baseContract.expectedVersion,
            baseRevision: baseContract.baseRevision,
          }
        : {}),
    },
  };
};

/**
 * A note write folded into a pending one keeps every stored text it may replace: the first
 * edit's base, and the texts this device already sent for that note, since one of them may have
 * landed without its answer.
 */
const mergeHandoffBases = (
  previous: SpecialistHandoffSyncPayload,
  next: SpecialistHandoffSyncPayload
): SpecialistHandoffSyncPayload => ({
  ...next,
  expectedOccupants: next.expectedOccupants.map(target => {
    const before = previous.expectedOccupants.find(
      item => item.bedId === target.bedId && item.target === target.target
    );
    if (!before?.handoffBases || !target.handoffBases) return target;
    const path = `beds.${target.bedId}${target.target === 'clinicalCrib' ? '.clinicalCrib' : ''}`;
    const sent =
      `${path}.medicalHandoffNote` in previous.patch &&
      `${path}.medicalHandoffEntries` in previous.patch
        ? [
            specialistHandoffTextState({
              medicalHandoffNote: previous.patch[`${path}.medicalHandoffNote`] as string,
              medicalHandoffEntries: previous.patch[
                `${path}.medicalHandoffEntries`
              ] as PatientData['medicalHandoffEntries'],
            }),
          ]
        : [];
    const [first, ...rest] = [
      ...new Set([...before.handoffBases, ...sent, ...target.handoffBases]),
    ];
    return { ...target, handoffBases: [first, ...rest.slice(-7)] };
  }),
});

const handoffPaths = (task: SyncTask) =>
  Object.keys((task.payload as SpecialistHandoffSyncPayload).patch).filter(
    path => path !== 'dateTimestamp'
  );

/**
 * A specialist note is its own task, not a day write. Its projection lands on the stored day by
 * the same stale-base rules, but never changes a projection a pending day task still holds.
 * It publishes nothing, so the day keeps the version it was read at: no later write or read takes
 * a note shown only on this device for a version of the server's day. The task keeps what the
 * projection replaced, so a note that can no longer publish leaves the day as it was.
 */
const saveSpecialistHandoffInOutbox = (
  record: DailyRecord,
  task: SyncTask,
  patchWrite?: DailyRecordPatchWrite
) =>
  hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    const stored = await hospitalDB.dailyRecords.get(record.date);
    const before = stored ?? patchWrite?.baseRecord ?? record;
    const projection = {
      ...(stored && patchWrite ? buildPatchRebase(patchWrite)(stored, []) : record),
      lastUpdated: before.lastUpdated,
    };
    const projected = !(await listUnresolvedDailyRecordTasks(record.date)).length;
    const persistedRecord = projected ? projection : (stored ?? record);
    if (projected) await hospitalDB.dailyRecords.put(projection);
    const existing = task.key
      ? await findReusableSyncTask(task.type, task.key, task.ownerKey)
      : null;
    const paths = handoffPaths(task);
    // A pending edit of this note already projected; a refused one gave its values back.
    const pendingProjection =
      existing?.status === 'PENDING' ? existing.handoffProjection : undefined;
    const handoffProjection = projected
      ? {
          replaced: {
            ...Object.fromEntries(paths.map(path => [path, getValueAtPath(before, path)])),
            ...pendingProjection?.replaced,
          },
          projected: Object.fromEntries(
            paths.map(path => [path, getValueAtPath(projection, path)])
          ),
        }
      : (pendingProjection ?? { replaced: {}, projected: {} });
    const nextTask = {
      ...task,
      payload: existing
        ? mergeHandoffBases(
            existing.payload as SpecialistHandoffSyncPayload,
            task.payload as SpecialistHandoffSyncPayload
          )
        : task.payload,
      syncContract: mergeSyncTaskContracts(existing?.syncContract, task.syncContract),
      handoffProjection,
    };
    if (existing?.id) {
      await hospitalDB.syncQueue.put({ ...existing, ...nextTask, id: existing.id });
      return { mode: 'reused' as const, persistedRecord };
    }
    await hospitalDB.syncQueue.add(nextTask);
    return { mode: 'created' as const, persistedRecord };
  });

/**
 * A note that can no longer publish (refused, failed or discarded) stops shaping the day. Where the
 * stored day, or a day write folded on top of it, still shows what the note projected, those fields
 * go back to what it replaced; the text stays in the note's task and drafts. A note queued before
 * this rule recorded nothing, and its projection may have moved the day's version: the day then
 * counts as older than any server version, so the next read takes the server's day, and a day
 * write queued meanwhile merges by its changed paths.
 */
export const releaseSpecialistHandoffProjection = (task: SyncTask): Promise<void> =>
  hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    const { date } = task.payload as SpecialistHandoffSyncPayload;
    const projection = task.handoffProjection;
    const stored = await hospitalDB.dailyRecords.get(date);
    const dayTasks = (await listUnresolvedDailyRecordTasks(date)).filter(dayTask => dayTask.id);
    if (!projection) {
      if (stored && !dayTasks.length)
        await hospitalDB.dailyRecords.put({ ...stored, lastUpdated: UNKNOWN_SERVER_VERSION });
      for (const dayTask of dayTasks)
        await hospitalDB.syncQueue.update(dayTask.id!, {
          syncContract: { ...dayTask.syncContract, expectedVersion: UNKNOWN_SERVER_VERSION },
        });
      return;
    }
    const restore = (day: DailyRecord): DailyRecord | null => {
      const restored = Object.fromEntries(
        Object.entries(projection.replaced).filter(([path]) =>
          hasSameComparableValue(getValueAtPath(day, path), projection.projected[path])
        )
      );
      return Object.keys(restored).length
        ? { ...applyPatches(day, restored as DailyRecordPatch), lastUpdated: day.lastUpdated }
        : null;
    };
    const day = stored && restore(stored);
    if (day) await hospitalDB.dailyRecords.put(day);
    for (const dayTask of dayTasks) {
      const payload = restore(dayTask.payload as DailyRecord);
      if (payload) await hospitalDB.syncQueue.update(dayTask.id!, { payload });
    }
  });

/** Writes the day's record and its outbox task in one transaction. */
export const saveDailyRecordInOutbox = (
  record: DailyRecord,
  task: SyncTask,
  patchWrite?: DailyRecordPatchWrite
): Promise<{ mode: 'created' | 'reused'; persistedRecord: DailyRecord }> => {
  if (task.type === 'UPDATE_SPECIALIST_HANDOFF')
    return saveSpecialistHandoffInOutbox(record, task, patchWrite);
  const rebase = patchWrite
    ? buildPatchRebase(patchWrite)
    : buildRecordOverlayRebase(
        record,
        task.syncContract?.changedPaths,
        task.origin === 'conflict_auto_merge'
      );
  return hospitalDB
    .transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
      const existing = task.key
        ? await findReusableSyncTask(task.type, task.key, task.ownerKey)
        : null;
      const nextTask = foldWriteIntoOutbox({
        task,
        existing,
        rebase,
        stored: await hospitalDB.dailyRecords.get(record.date),
        unresolved: (await listUnresolvedDailyRecordTasks(record.date)).filter(
          candidate =>
            candidate.type === task.type && matchesOwner(task.ownerKey, candidate.ownerKey)
        ),
      });
      const persistedRecord = nextTask.payload as DailyRecord;
      await hospitalDB.dailyRecords.put(persistedRecord);
      if (existing?.id) {
        await hospitalDB.syncQueue.put({ ...existing, ...nextTask, id: existing.id });
        return { mode: 'reused' as const, persistedRecord };
      }
      await hospitalDB.syncQueue.add(nextTask);
      return { mode: 'created' as const, persistedRecord };
    })
    .catch(error => {
      // A refused stale write leaves nothing behind; the caller gets the conflict.
      if (error instanceof ConcurrencyError) {
        recordOperationalTelemetry({
          category: 'sync',
          operation: 'sync_queue_task_conflict',
          status: 'degraded',
          runtimeState: 'recoverable',
          issues: [error.message],
          context: {
            type: task.type,
            date: record.date,
            contexts: task.contexts,
            origin: task.origin,
          },
        });
      }
      throw error;
    });
};
