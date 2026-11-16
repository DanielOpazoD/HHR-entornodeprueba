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
import type { DailyRecordPatchWrite } from '@/services/storage/sync/syncQueuePorts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
// The replay-time occupant checks ship with the enqueue-time one, with the durable writer.
export { detachStaleOccupantPaths } from '@/services/storage/sync/dayTaskOccupantDetach';
export {
  hasOtherOccupantInUntouchedBed,
  keepStoredNoteFields,
} from '@/services/storage/sync/dayTaskReplayGuard';
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
  const merged = mergeSyncTaskContracts(existing?.syncContract, task.syncContract);
  const payload = rebased ?? (task.payload as DailyRecord);
  const previous = existing ?? owner;
  const baseContract = previous?.syncContract;
  const patchBaseValues = { ...previous?.patchBaseValues };
  if (patchWrite) {
    const base = patchWrite.prepare(patchWrite.baseRecord, {});
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
  return {
    ...task,
    payload,
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
