import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueStorePort, SyncRuntimePort } from '@/services/storage/sync/syncQueuePorts';
import type { PendingDailyRecordSyncTaskIdentity } from '@/services/storage/sync/pendingDailyRecordSyncTask';
import { buildSyncQueueTaskContextMeta } from '@/services/storage/sync/syncQueueFailurePolicy';
import {
  buildSyncTaskContract,
  mergeSyncTaskContracts,
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

export const replacePendingDailyRecordTask = async ({
  record,
  meta,
  store,
  runtime,
  triggerProcessing,
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

  const replacementTask = buildPendingDailyRecordReplacementTask({ record, meta, existing });
  const replaced = await store.replacePendingDailyRecordWithTask(
    record,
    { ...replacementTask, key, ownerKey: ownerKey ?? undefined },
    expectedTask
  );
  if (replaced) triggerProcessing();
  return replaced;
};
