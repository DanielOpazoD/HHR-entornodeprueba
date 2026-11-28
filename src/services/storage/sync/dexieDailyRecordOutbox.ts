/**
 * The durable writer of the day and its outbox tasks. The outbox store loads it before editing is
 * available, including offline.
 */
import {
  assertFullSaveNoteBase,
  assertPendingFullSaveBase,
  assertSameOccupantAtPath,
  hasSamePatchBaseValue,
  localProjectionIds,
  staleDailyRecordError,
} from '@/services/storage/sync/fullSaveNoteBaseGuard';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import { applyPatches } from '@/utils/patchUtils';
import type { DailyRecordPatchWrite } from '@/services/storage/sync/syncQueuePorts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
// The replay-time occupant checks ship with the enqueue-time one, with the durable writer.
export {
  hasOtherOccupantInUntouchedBed,
  keepStoredNoteFields,
  stripStaleOccupantPaths,
} from '@/services/storage/sync/dayTaskReplayGuard';
import {
  pathsOverlap,
  stripStaleOccupantPaths,
  withVacatedSlots,
} from '@/services/storage/sync/dayTaskReplayGuard';
import { mergeMovementArrayById } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import { mergeRayenSyncHistory } from '@/services/repositories/dailyRecordRayenSyncHistoryPolicy';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { capturePatchBaseContext } from './dailyRecordPatchBase';
export { hasUnchangedPatchBase } from './dailyRecordPatchBase';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  findReusableSyncTask,
  listDailyRecordProjectionHolders,
  matchesOwner,
} from '@/services/storage/sync/dexieSyncQueueQuarantine';
import {
  buildDailyRecordSyncContract,
  mergeSyncTaskContracts,
  resolveRecordBaseRevision,
} from '@/services/storage/sync/syncTaskContractPolicy';

type PendingProjectionRebase = (projection: DailyRecord, pendingPaths: string[]) => DailyRecord;

// Same mergeable roots as the publish-time same-path check (firestoreSyncConflictPolicy).
const MOVEMENT_LOG_PATHS = new Set(['discharges', 'transfers', 'cma']);

/** A legacy or whole-record write does not say which paths it owns. */
const isOpaqueChangedPaths = (paths: readonly string[]): boolean =>
  paths.length === 0 || paths.includes('*');

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
        throw staleDailyRecordError('Otra pestaña cambió esta corrida Rayen');
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
export const buildPatchRebase =
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
        throw staleDailyRecordError('Otra pestaña cambió este dato');
      }
      rebasedPatch[path] = merged;
    });
    return prepare(projection, rebasedPatch);
  };

/**
 * The outbox task one write leaves for the day. When an unresolved write still holds the stored
 * projection as its payload, the write lands on that projection and keeps that write's remote base.
 */
export const foldWriteIntoOutbox = ({
  task,
  existing,
  stored,
  unresolved,
  rebase,
  wholeRecordBase,
  patchWrite,
}: {
  task: SyncTask;
  existing: SyncTask | null;
  stored: DailyRecord | undefined;
  unresolved: SyncTask[];
  rebase: PendingProjectionRebase | undefined;
  wholeRecordBase?: DailyRecord;
  patchWrite?: DailyRecordPatchWrite;
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
  if (!rebase) {
    assertPendingFullSaveBase({
      incoming: task.payload as DailyRecord,
      pending: unresolved,
      base: wholeRecordBase,
    });
  }
  const rebased = stored && rebase ? rebase(stored, pendingPaths) : null;
  const payload = rebased ?? (task.payload as DailyRecord);
  // A write that empties a bed or crib (a discharge, a transfer) strips unsent edits written for
  // the patient who leaves (ID-05) so they never carry onto the empty slot or its next occupant.
  const stripped =
    existing && stored
      ? stripStaleOccupantPaths(existing, stored, withVacatedSlots(stored, payload))
      : null;
  const merged = mergeSyncTaskContracts(
    (stripped?.task ?? existing)?.syncContract,
    task.syncContract
  );
  // The held write's remote version stays this write's version, as for any compaction below.
  const previous = stripped?.task ?? existing ?? owner;
  const baseContract = previous?.syncContract;
  const patchBaseValues = { ...previous?.patchBaseValues };
  const patchBaseRevisions = { ...previous?.patchBaseRevisions };
  if (patchWrite) {
    // Where an edit was stripped, this write's base is the value that edit was written over,
    // never its unsent text (#1661): the server holding that value is not a change elsewhere.
    const remaining = stripped?.task.syncContract?.changedPaths ?? [];
    const heldBases = Object.fromEntries(
      (stripped ? (existing?.syncContract?.changedPaths ?? []) : [])
        .filter(
          path => !remaining.includes(path) && Object.hasOwn(existing?.patchBaseValues ?? {}, path)
        )
        .map(path => [path, existing?.patchBaseValues?.[path]])
    ) as DailyRecordPatch;
    const base = patchWrite.prepare(applyPatches(patchWrite.baseRecord, heldBases), {});
    for (const path of Object.keys(patchWrite.patch)) {
      const overlapsPending = (previous?.syncContract?.changedPaths ?? ['*']).some(
        pending =>
          pending === '*' ||
          pending === path ||
          pending.startsWith(`${path}.`) ||
          path.startsWith(`${pending}.`)
      );
      if (previous && overlapsPending) continue;
      patchBaseValues[path] = getValueAtPath(base, path);
      // The revision of the copy that value came from: the census, or the held edit's own.
      const revision = Object.hasOwn(heldBases, path)
        ? existing?.patchBaseRevisions?.[path]
        : resolveRecordBaseRevision(patchWrite.baseRecord);
      if (revision === undefined) delete patchBaseRevisions[path];
      else patchBaseRevisions[path] = revision;
    }
  }
  // A direct write of fields the held conflict does not hold: once the server confirms it, the
  // task is that conflict again, not a resend that meets the same refusal (W12-CW11).
  const heldPaths = existing?.syncContract?.changedPaths ?? ['*'];
  const conflictBeforeDirectWrite =
    task.preOutboxHoldState &&
    existing?.status === 'CONFLICT' &&
    !(task.syncContract?.changedPaths ?? ['*']).some(path =>
      heldPaths.some(held => held === '*' || path === '*' || pathsOverlap(path, held))
    )
      ? {
          error: existing.error,
          lastErrorCode: existing.lastErrorCode,
          lastErrorCategory: existing.lastErrorCategory,
          lastErrorSeverity: existing.lastErrorSeverity,
          lastErrorAction: existing.lastErrorAction,
          lastErrorAt: existing.lastErrorAt,
        }
      : undefined;
  return {
    ...task,
    payload,
    conflictBeforeDirectWrite,
    patchBaseValues,
    patchBaseRevisions,
    patchBaseContext: previous
      ? previous.patchBaseContext
      : patchWrite
        ? capturePatchBaseContext(patchWrite.baseRecord)
        : undefined,
    localProjectionBaseIds: [...localProjectionIds(owner)],
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

/** Writes the day's record and its outbox task in one transaction. */
export const saveDailyRecordInOutbox = (
  record: DailyRecord,
  task: SyncTask,
  patchWrite?: DailyRecordPatchWrite,
  wholeRecordBase?: DailyRecord
): Promise<{ mode: 'created' | 'reused'; persistedRecord: DailyRecord }> => {
  const rebase = patchWrite
    ? buildPatchRebase(patchWrite)
    : buildRecordOverlayRebase(
        record,
        task.syncContract?.changedPaths,
        task.origin === 'conflict_auto_merge'
      );
  return hospitalDB
    .transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
      // First: this may release a write without its copy, which must not be reused below.
      const holders = await listDailyRecordProjectionHolders(record.date);
      const existing = task.key
        ? await findReusableSyncTask(task.type, task.key, task.ownerKey, task)
        : null;
      const stored = await hospitalDB.dailyRecords.get(record.date);
      if (!patchWrite && isOpaqueChangedPaths(task.syncContract?.changedPaths ?? [])) {
        assertFullSaveNoteBase(record, stored, wholeRecordBase);
      }
      const nextTask = foldWriteIntoOutbox({
        task,
        existing,
        rebase,
        stored,
        wholeRecordBase,
        patchWrite,
        unresolved: holders.filter(
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

/** A remote-first full save must validate its note base before reaching the network. */
export const assertWholeRecordNoteBase = (record: DailyRecord, base?: DailyRecord): Promise<void> =>
  hospitalDB.transaction('r', hospitalDB.dailyRecords, async () => {
    const stored = await hospitalDB.dailyRecords.get(record.date);
    assertFullSaveNoteBase(record, stored, base);
  });
