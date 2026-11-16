import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { matchesTaskClaim } from '@/services/storage/sync/syncQueueTaskFactory';
import type {
  SyncQueueStorePort,
  SyncQueueLeaseClaim,
  DirectDailyRecordAckInput,
  DirectDailyRecordAckResult,
} from '@/services/storage/sync/syncQueuePorts';
import { hasSameComparableValue } from '@/services/repositories/conflictResolutionUtils';
import { isNursingHandoffPath } from './nursingHandoffTasks';
import { clearSyncTaskRuntimeState } from './syncQueueTaskFactory';
import { detachStaleOccupantPaths } from './dayTaskOccupantDetach';

import {
  REUSABLE_TASK_STATES,
  listDailyRecordProjectionHolders,
  matchesOwner,
} from '@/services/storage/sync/dexieSyncQueueQuarantine';

interface AckRuntime {
  db: typeof hospitalDB;
  matchesClaim: typeof matchesTaskClaim;
  pending: typeof listDailyRecordProjectionHolders;
}

class SyncQueueAckError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SyncQueueAckError';
  }
}

export const completeDirectDailyRecord = async ({
  sentRecord,
  confirmedRecord,
  mutationId,
  ownerKey,
}: DirectDailyRecordAckInput): Promise<DirectDailyRecordAckResult> => {
  if (!mutationId.trim() || sentRecord.date !== confirmedRecord.date) {
    throw new SyncQueueAckError('sync_ack_invalid_record', 'Invalid direct ACK identity.');
  }
  return hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    const unresolved = await listDailyRecordProjectionHolders(sentRecord.date);
    const matching = unresolved.filter(
      task =>
        task.type === 'UPDATE_DAILY_RECORD' &&
        matchesOwner(ownerKey, task.ownerKey) &&
        task.status === 'PENDING' &&
        task.syncContract?.mutationId === mutationId
    );
    if (matching.length > 1) {
      throw new SyncQueueAckError('sync_ack_projection_conflict', 'Ambiguous direct ACK.');
    }
    const [candidate] = matching;
    const eligible =
      candidate &&
      !candidate.syncContract?.mutationIds?.some(id => id !== mutationId) &&
      hasSameComparableValue(candidate.payload, sentRecord)
        ? candidate
        : undefined;
    const local = await hospitalDB.dailyRecords.get(sentRecord.date);
    if (!local) {
      throw new SyncQueueAckError('sync_ack_missing_projection', 'Missing local projection.');
    }
    const remaining = unresolved.filter(task => !eligible || task.id !== eligible.id);
    if (remaining.length) {
      if (eligible?.id) await hospitalDB.syncQueue.delete(eligible.id);
      const releasedHold = Boolean(
        candidate?.id && !eligible && candidate.preOutboxHoldState === 'AWAITING_REMOTE_ACK'
      );
      if (releasedHold && candidate?.id) {
        await hospitalDB.syncQueue.update(candidate.id, {
          nextAttemptAt: 0,
          preOutboxHoldState: undefined,
          preOutboxHoldOwner: undefined,
          preOutboxHoldUntil: undefined,
          preOutboxHoldReason: undefined,
          preOutboxHoldHeartbeatAt: undefined,
        });
      }
      return { status: 'retained', record: local, releasedHold };
    }
    if (!eligible) {
      if (!hasSameComparableValue(local, confirmedRecord)) {
        throw new SyncQueueAckError('sync_ack_projection_conflict', 'Stale direct ACK.');
      }
      return { status: 'adopted', record: local };
    }
    if (
      !hasSameComparableValue(local, sentRecord) &&
      !hasSameComparableValue(local, confirmedRecord)
    ) {
      throw new SyncQueueAckError(
        'sync_ack_projection_conflict',
        'Direct ACK projection conflict.'
      );
    }
    await hospitalDB.dailyRecords.put(confirmedRecord);
    if (eligible.id) await hospitalDB.syncQueue.delete(eligible.id);
    return { status: 'adopted', record: confirmedRecord };
  });
};

/** Writes edits held for a patient no longer in their bed, one conflict per bed or crib. */
const keepDetachedConflicts = async (
  db: typeof hospitalDB,
  conflicts: SyncTask[],
  ownerKey: string | undefined
) => {
  for (const conflict of conflicts) {
    const existing = conflict.key
      ? await db.syncQueue.where('key').equals(conflict.key).first()
      : undefined;
    if (existing?.id) await db.syncQueue.put({ ...conflict, id: existing.id });
    else await db.syncQueue.add({ ...conflict, ownerKey });
  }
};

export const completeClaimedSyncTask = (
  { db, matchesClaim, pending }: AckRuntime,
  taskId: number,
  claim: SyncQueueLeaseClaim,
  authoritativeRecord?: DailyRecord,
  detachedConflicts: SyncTask[] = []
): Promise<{ deleted: boolean; adopted: boolean }> =>
  db.transaction('rw', db.syncQueue, db.dailyRecords, async () => {
    const task = await db.syncQueue.get(taskId);
    if (!matchesClaim(task, claim)) return { deleted: false, adopted: false };
    let adopted = false;
    if (authoritativeRecord) {
      const payload = task.payload as Partial<DailyRecord> | undefined;
      const dayKey = `daily:${authoritativeRecord.date}`;
      if (
        task.type !== 'UPDATE_DAILY_RECORD' ||
        // A held conflict published once its patient is back completes like its day task.
        (task.key !== dayKey && !task.key?.startsWith(`${dayKey}:detached:`)) ||
        payload?.date !== authoritativeRecord.date
      )
        throw new SyncQueueAckError('sync_ack_invalid_record', 'Invalid ACK record.');
      const local = await db.dailyRecords.get(authoritativeRecord.date);
      const unresolved = (await pending(authoritativeRecord.date)).some(
        candidate => candidate.id !== taskId
      );
      if (unresolved) {
        if (!local)
          throw new SyncQueueAckError('sync_ack_missing_projection', 'Missing local projection.');
      } else {
        if (
          !task.nursingHandoffRecovery &&
          local &&
          local.lastUpdated !== payload.lastUpdated &&
          local.lastUpdated !== authoritativeRecord.lastUpdated
        )
          throw new SyncQueueAckError('sync_ack_projection_conflict', 'ACK version conflict.');
        await db.dailyRecords.put(authoritativeRecord);
        adopted = true;
      }
    }
    // Edits detached from this task stay durable, as conflicts, before the task leaves the queue.
    await keepDetachedConflicts(db, detachedConflicts, task.ownerKey);
    const remaining = task.nursingHandoffRecovery
      ? (task.syncContract?.changedPaths?.filter(path => !isNursingHandoffPath(path)) ?? [])
      : [];
    if (remaining.length) {
      // Preserve the unrelated work and its original payload; this ACK confirms only nursing.
      await db.syncQueue.update(taskId, {
        ...clearSyncTaskRuntimeState(),
        status: 'FAILED',
        projectionReleased: true,
        nursingHandoffRecovery: undefined,
        syncContract: { ...task.syncContract, changedPaths: remaining },
        lastErrorCode: 'session_owner_logged_out',
        lastErrorCategory: 'authorization',
        lastErrorAction: 'review_owned_pending_changes',
        error: 'Sesión cerrada. Revisa los cambios pendientes con su usuario original.',
      });
    } else await db.syncQueue.delete(taskId);
    return { deleted: true, adopted };
  });

export const adoptAuthoritativeDailyRecordInOutbox: NonNullable<
  SyncQueueStorePort['adoptAuthoritativeDailyRecord']
> = (authoritativeRecord, ownerKey, buildReplacement) =>
  hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    const unresolvedTasks = (
      await listDailyRecordProjectionHolders(authoritativeRecord.date)
    ).filter(task => matchesOwner(ownerKey, task.ownerKey));
    const blocked = { status: 'blocked' as const };
    if (unresolvedTasks.length === 0) {
      await hospitalDB.dailyRecords.put(authoritativeRecord);
      return { status: 'adopted' as const, record: authoritativeRecord };
    }
    const [heldTask] = unresolvedTasks;
    if (unresolvedTasks.length !== 1 || !heldTask) return blocked;
    const localRecord = await hospitalDB.dailyRecords.get(authoritativeRecord.date);
    const pendingPayload = heldTask.payload as Partial<DailyRecord> | null | undefined;
    if (
      !REUSABLE_TASK_STATES.has(heldTask.status) ||
      !localRecord ||
      pendingPayload?.date !== localRecord.date ||
      pendingPayload.lastUpdated !== localRecord.lastUpdated
    ) {
      return blocked;
    }
    // The confirmed command emptied a bed or put another patient in it (ID-01): edits written for
    // the patient who left are never rebased onto it nor dropped as covered by it (SAVE-03). They
    // stay for that patient as a conflict, as a replay keeps them (`detachStaleOccupantPaths`).
    const detached = detachStaleOccupantPaths(
      heldTask,
      pendingPayload as DailyRecord,
      authoritativeRecord
    );
    const pendingTask = detached?.task ?? heldTask;
    const replacement =
      detached && !pendingTask.syncContract?.changedPaths?.length
        ? { record: authoritativeRecord, task: null }
        : buildReplacement(localRecord, pendingTask);
    // A confirmed command may fully supersede quarantine. Residual edits must
    // remain quarantined; reconciliation alone does not authorize retrying them.
    if (
      !replacement ||
      !pendingTask.id ||
      (pendingTask.status !== 'PENDING' && replacement.task !== null)
    )
      return blocked;
    await hospitalDB.dailyRecords.put(replacement.record);
    await keepDetachedConflicts(hospitalDB, detached?.conflicts ?? [], pendingTask.ownerKey);
    if (replacement.task === null) {
      // Supersesión total: el comando confirmado ya cubre todo lo pendiente.
      // Reemplazarla re-declararía paths ya aplicados y mantendría viva la
      // propiedad del subárbol, bloqueando el siguiente comando cama–cuna.
      await hospitalDB.syncQueue.delete(pendingTask.id);
      return { status: 'adopted' as const, record: replacement.record };
    }
    await hospitalDB.syncQueue.put({
      ...pendingTask,
      ...replacement.task,
      id: pendingTask.id,
    });
    return { status: 'replaced' as const, record: replacement.record };
  });
