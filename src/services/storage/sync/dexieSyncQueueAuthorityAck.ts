import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { matchesTaskClaim } from '@/services/storage/sync/syncQueueTaskFactory';
import type {
  SyncQueueStorePort,
  SyncQueueLeaseClaim,
  DirectDailyRecordAckInput,
  DirectDailyRecordAckResult,
} from '@/services/storage/sync/syncQueuePorts';
import { UNKNOWN_SERVER_VERSION } from '@/services/storage/sync/syncTaskContractPolicy';
import { hasSameComparableValue } from '@/services/repositories/conflictResolutionUtils';

import {
  matchesOwner,
  REUSABLE_TASK_STATES,
  listUnresolvedDailyRecordTasks,
} from '@/services/storage/sync/dexieSyncQueueQuarantine';

interface AckRuntime {
  db: typeof hospitalDB;
  matchesClaim: typeof matchesTaskClaim;
  pending: typeof listUnresolvedDailyRecordTasks;
  confirmNote: (task: SyncTask) => Promise<boolean>;
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
    const unresolved = await listUnresolvedDailyRecordTasks(sentRecord.date);
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

export const completeClaimedSyncTask = async (
  { db, matchesClaim, pending, confirmNote }: AckRuntime,
  taskId: number,
  claim: SyncQueueLeaseClaim,
  authoritativeRecord?: DailyRecord,
  detachedConflicts: SyncTask[] = []
): Promise<{ deleted: boolean; adopted: boolean; noteProjectionDate?: string }> => {
  let handoffNotes = false;
  const result = await db.transaction('rw', db.syncQueue, db.dailyRecords, async () => {
    const task = await db.syncQueue.get(taskId);
    if (!matchesClaim(task, claim)) return { deleted: false, adopted: false };
    const noteProjectionDate =
      task.type === 'UPDATE_SPECIALIST_HANDOFF' && (await confirmNote(task))
        ? (task.payload as SpecialistHandoffSyncPayload).date
        : undefined;
    handoffNotes = Boolean(
      task.syncContract?.changedPaths?.some(path => path.includes('.medicalHandoffEntries'))
    );
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
        // Legacy note repair invalidates only the cached server version, preserving queued
        // intent. Accept its ACK only when every other cached value still matches that intent.
        const invalidatedVersionOnly =
          local?.lastUpdated === UNKNOWN_SERVER_VERSION &&
          task.syncContract?.expectedVersion === UNKNOWN_SERVER_VERSION &&
          hasSameComparableValue(local, { ...payload, lastUpdated: UNKNOWN_SERVER_VERSION });
        if (
          local &&
          local.lastUpdated !== payload.lastUpdated &&
          local.lastUpdated !== authoritativeRecord.lastUpdated &&
          !invalidatedVersionOnly
        )
          throw new SyncQueueAckError('sync_ack_projection_conflict', 'ACK version conflict.');
        await db.dailyRecords.put(authoritativeRecord);
        adopted = true;
      }
    }
    // Edits detached from this task stay durable, as conflicts, before the task leaves the queue.
    for (const conflict of detachedConflicts) {
      const existing = conflict.key
        ? await db.syncQueue.where('key').equals(conflict.key).first()
        : undefined;
      if (existing?.id) await db.syncQueue.put({ ...conflict, id: existing.id });
      else await db.syncQueue.add({ ...conflict, ownerKey: task.ownerKey });
    }
    await db.syncQueue.delete(taskId);
    return { deleted: true, adopted, noteProjectionDate };
  });
  // The server now holds this record: drafts with exactly its text for the same patient are saved.
  if (result.deleted && authoritativeRecord && handoffNotes)
    (await import('../medicalHandoffDraftStorage')).confirmMedicalHandoffDraftsFromRecord(
      authoritativeRecord
    );
  return result;
};

export const adoptAuthoritativeDailyRecordInOutbox: NonNullable<
  SyncQueueStorePort['adoptAuthoritativeDailyRecord']
> = (authoritativeRecord, ownerKey, buildReplacement) =>
  hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    const unresolvedTasks = (await listUnresolvedDailyRecordTasks(authoritativeRecord.date)).filter(
      task => matchesOwner(ownerKey, task.ownerKey)
    );
    const blocked = { status: 'blocked' as const };
    if (unresolvedTasks.length === 0) {
      await hospitalDB.dailyRecords.put(authoritativeRecord);
      return { status: 'adopted' as const, record: authoritativeRecord };
    }
    if (unresolvedTasks.length !== 1) return blocked;
    const [pendingTask] = unresolvedTasks;
    const localRecord = await hospitalDB.dailyRecords.get(authoritativeRecord.date);
    const pendingPayload = pendingTask.payload as Partial<DailyRecord> | null | undefined;
    if (
      !REUSABLE_TASK_STATES.has(pendingTask.status) ||
      !localRecord ||
      pendingPayload?.date !== localRecord.date ||
      pendingPayload.lastUpdated !== localRecord.lastUpdated
    ) {
      return blocked;
    }
    const replacement = buildReplacement(localRecord, pendingTask);
    // A confirmed command may fully supersede quarantine. Residual edits must
    // remain quarantined; reconciliation alone does not authorize retrying them.
    if (
      !replacement ||
      !pendingTask.id ||
      (pendingTask.status !== 'PENDING' && replacement.task !== null)
    )
      return blocked;
    await hospitalDB.dailyRecords.put(replacement.record);
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
