import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueStorePort, SyncRuntimePort } from '@/services/storage/sync/syncQueuePorts';
import type { PendingDailyRecordSyncTaskIdentity } from '@/services/storage/sync/pendingDailyRecordSyncTask';
import { buildSyncQueueTaskContextMeta } from '@/services/storage/sync/syncQueueFailurePolicy';
import {
  buildSyncTaskContract,
  mergeSyncTaskContracts,
  assertPendingHandoffContinuity,
  preserveIncompatibleHandoffTask,
} from '@/services/storage/sync/syncTaskContractPolicy';
import {
  clearSyncTaskRuntimeState,
  getSyncTaskKey,
} from '@/services/storage/sync/syncQueueTaskFactory';

export type ReplacementMeta = Pick<
  SyncTask,
  'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'
>;

export const buildPendingDailyRecordReplacementTask = ({
  record,
  meta,
  existing,
}: {
  record: DailyRecord;
  meta?: ReplacementMeta;
  existing: SyncTask;
}): SyncTask => {
  assertPendingHandoffContinuity(existing, record);
  const contextMeta = buildSyncQueueTaskContextMeta({
    contexts: meta?.contexts,
    recoveryPolicy: meta?.recoveryPolicy,
  });
  return {
    ...existing,
    payload: record,
    timestamp: Date.now(),
    retryCount: 0,
    contexts: contextMeta.contexts,
    origin: meta?.origin || existing.origin || 'direct_queue',
    recoveryPolicy: contextMeta.recoveryPolicy,
    syncContract: mergeSyncTaskContracts(
      existing.syncContract,
      buildSyncTaskContract('UPDATE_DAILY_RECORD', record, meta?.syncContract)
    ),
    ...clearSyncTaskRuntimeState(),
    nextAttemptAt: 0,
  };
};

const replaceWithinTransaction = async ({
  record,
  meta,
  store,
  runtime,
  expectedTask,
}: {
  record: DailyRecord;
  meta?: ReplacementMeta;
  store: SyncQueueStorePort;
  runtime: SyncRuntimePort;
  triggerProcessing: () => void;
  expectedTask?: PendingDailyRecordSyncTaskIdentity;
}): Promise<boolean> => {
  if (!store.replacePendingDailyRecordWithTask) return false;
  const type: SyncTask['type'] = 'UPDATE_DAILY_RECORD';
  const key = getSyncTaskKey(type, record);
  const ownerKey = runtime.getOwnerKey();
  if (!key) return false;
  const existing = await store.findReusableTask(type, key, ownerKey);
  if (!existing?.id) return false;
  if (
    expectedTask &&
    (existing.id !== expectedTask.taskId ||
      (existing.payload as Partial<DailyRecord> | null | undefined)?.lastUpdated !==
        expectedTask.recordRevision ||
      existing.syncContract?.mutationId !== expectedTask.mutationId)
  ) {
    return false;
  }

  // A replacement cannot acknowledge the orphan as saved. Leave it in quarantine
  // and let the caller enqueue the fresh write through the ordinary atomic path.
  if (!(await preserveIncompatibleHandoffTask(store, existing, record))) return false;
  const replacementTask = buildPendingDailyRecordReplacementTask({ record, meta, existing });
  const replaced = await store.replacePendingDailyRecordWithTask(
    record,
    { ...replacementTask, key, ownerKey: ownerKey ?? undefined },
    expectedTask
  );
  return replaced;
};

export const replacePendingDailyRecordTask = async (
  args: Parameters<typeof replaceWithinTransaction>[0]
): Promise<boolean> => {
  const operation = () => replaceWithinTransaction(args);
  const replaced = await (args.store.withEnqueueTransaction
    ? args.store.withEnqueueTransaction(operation)
    : operation());
  if (replaced) args.triggerProcessing();
  return replaced;
};
