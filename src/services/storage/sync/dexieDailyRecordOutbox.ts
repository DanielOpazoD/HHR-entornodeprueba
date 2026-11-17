/**
 * The durable writer of the day and its outbox tasks. The outbox store loads it before editing is
 * available, including offline.
 */
import {
  assertFullSaveNoteBase,
  assertPendingFullSaveBase,
  localProjectionIds,
} from '@/services/storage/sync/fullSaveNoteBaseGuard';
import {
  buildPatchRebase,
  buildRecordOverlayRebase,
  isOpaqueChangedPaths,
  type PendingProjectionRebase,
} from '@/services/storage/sync/pendingProjectionRebase';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { applyPatches } from '@/utils/patchUtils';
import type { DailyRecordPatchWrite } from '@/services/storage/sync/syncQueuePorts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
// The replay-time occupant checks ship with the enqueue-time one, with the durable writer.
export { detachStaleOccupantPaths } from '@/services/storage/sync/dayTaskOccupantDetach';
import {
  detachStaleOccupantPaths,
  keepDetachedConflicts,
  withVacatedSlots,
} from '@/services/storage/sync/dayTaskOccupantDetach';
export {
  hasOtherOccupantInUntouchedBed,
  keepStoredNoteFields,
} from '@/services/storage/sync/dayTaskReplayGuard';
import { pathsOverlap } from '@/services/storage/sync/dayTaskReplayGuard';
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
} from '@/services/storage/sync/syncTaskContractPolicy';

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
}): { task: SyncTask; heldConflicts: SyncTask[] } => {
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
  // A write that empties a bed or crib (a discharge, a transfer) never carries the unsent edits
  // written for the patient who leaves onto the empty slot or its next occupant, nor replaces them:
  // they stay held for that patient and episode (ID-01, SAVE-03), as when a confirmed command
  // empties the bed (`adoptAuthoritativeDailyRecordInOutbox`). The write keeps the rest.
  const detached =
    existing && stored
      ? detachStaleOccupantPaths(existing, stored, withVacatedSlots(stored, payload))
      : null;
  const merged = mergeSyncTaskContracts(
    (detached?.task ?? existing)?.syncContract,
    task.syncContract
  );
  // The held write's remote version stays this write's version, as for any compaction below.
  const previous = detached?.task ?? existing ?? owner;
  const baseContract = previous?.syncContract;
  const patchBaseValues = { ...previous?.patchBaseValues };
  if (patchWrite) {
    // Where an edit was detached, this write's base is the value that edit was written over,
    // never its unsent text (#1661): the server holding that value is not a change elsewhere.
    const remaining = detached?.task.syncContract?.changedPaths ?? [];
    const heldBases = Object.fromEntries(
      (detached ? (existing?.syncContract?.changedPaths ?? []) : [])
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
      if (!previous || !overlapsPending) patchBaseValues[path] = getValueAtPath(base, path);
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
  const nextTask: SyncTask = {
    ...task,
    payload,
    conflictBeforeDirectWrite,
    patchBaseValues,
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
  return { task: nextTask, heldConflicts: detached?.conflicts ?? [] };
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
        ? await findReusableSyncTask(task.type, task.key, task.ownerKey)
        : null;
      const stored = await hospitalDB.dailyRecords.get(record.date);
      if (!patchWrite && isOpaqueChangedPaths(task.syncContract?.changedPaths ?? [])) {
        assertFullSaveNoteBase(record, stored, wholeRecordBase);
      }
      const { task: nextTask, heldConflicts } = foldWriteIntoOutbox({
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
      await keepDetachedConflicts(hospitalDB, heldConflicts, existing?.ownerKey);
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
