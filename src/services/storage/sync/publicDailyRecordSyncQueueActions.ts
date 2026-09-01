import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueStorePort } from '@/services/storage/sync/syncQueuePorts';
import { recordSyncQueueAckFailure } from '@/services/storage/sync/syncQueueAckTelemetry';
import { getSyncTaskKey } from '@/services/storage/sync/syncQueueTaskFactory';
import type {
  PendingDailyRecordSyncTaskIdentity,
  PendingDailyRecordSyncTaskSnapshot,
} from '@/services/storage/sync/pendingDailyRecordSyncTask';
import type { DailyRecordAuthorityAdoptionResult } from '@/services/storage/sync/syncQueuePorts';

interface DailyRecordSyncQueueActionDependencies {
  ensureReady: () => Promise<void>;
  store: SyncQueueStorePort;
  getOwnerKey: () => string | null;
  logger: { warn: (message: string, error?: unknown) => void };
  replacePendingTask: (
    record: DailyRecord,
    meta?: Pick<SyncTask, 'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'>,
    expectedTask?: PendingDailyRecordSyncTaskIdentity
  ) => Promise<boolean>;
  triggerProcessing: () => void;
}

export const createDailyRecordSyncQueueActions = ({
  ensureReady,
  store,
  getOwnerKey,
  logger,
  replacePendingTask,
  triggerProcessing,
}: DailyRecordSyncQueueActionDependencies) => {
  const runPendingAction = async (
    record: DailyRecord,
    syncContract: SyncTask['syncContract'] | undefined,
    action: (key: string) => Promise<boolean>,
    onError: (error: unknown) => void
  ): Promise<boolean> => {
    try {
      await ensureReady();
      const key = getSyncTaskKey('UPDATE_DAILY_RECORD', record);
      return key ? action(key) : false;
    } catch (error) {
      onError(error);
      return false;
    }
  };

  const ackDailyRecordSyncTask = (
    record: DailyRecord,
    syncContract?: SyncTask['syncContract']
  ): Promise<boolean> =>
    runPendingAction(
      record,
      syncContract,
      key =>
        store.deletePendingByKey(
          'UPDATE_DAILY_RECORD',
          key,
          getOwnerKey(),
          syncContract?.mutationId
        ),
      error => {
        logger.warn('Failed to ack daily record sync task', error);
        recordSyncQueueAckFailure(record, syncContract, error);
      }
    );

  const releaseDailyRecordPreOutboxHold = (
    record: DailyRecord,
    syncContract?: SyncTask['syncContract']
  ): Promise<boolean> =>
    runPendingAction(
      record,
      syncContract,
      key =>
        store.releasePreOutboxHoldByKey(
          'UPDATE_DAILY_RECORD',
          key,
          getOwnerKey(),
          syncContract?.mutationId
        ),
      error => logger.warn('Failed to release pre-outbox hold', error)
    );

  const renewDailyRecordPreOutboxHold = (
    record: DailyRecord,
    syncContract: SyncTask['syncContract'] | undefined,
    holdForMs: number
  ): Promise<boolean> =>
    runPendingAction(
      record,
      syncContract,
      key =>
        store.renewPreOutboxHoldByKey(
          'UPDATE_DAILY_RECORD',
          key,
          getOwnerKey(),
          syncContract?.mutationId,
          syncContract?.tabId || syncContract?.clientId || 'unknown_direct_writer',
          Date.now(),
          holdForMs
        ),
      error => logger.warn('Failed to renew pre-outbox hold', error)
    );

  const getPendingDailyRecordSyncTaskSnapshot = async (
    record: DailyRecord
  ): Promise<PendingDailyRecordSyncTaskSnapshot | null> => {
    try {
      await ensureReady();
      const key = getSyncTaskKey('UPDATE_DAILY_RECORD', record);
      if (!key) return null;
      const task = await store.findReusableTask('UPDATE_DAILY_RECORD', key, getOwnerKey());
      const payload = task?.payload as DailyRecord | null | undefined;
      if (
        !task?.id ||
        // findReusableTask también entrega tareas en cuarentena (para que la
        // edición fresca las superseda); este snapshot describe SOLO pendientes.
        task.status !== 'PENDING' ||
        payload?.date !== record.date ||
        payload.lastUpdated !== record.lastUpdated
      ) {
        return null;
      }
      return {
        taskId: task.id,
        record: payload,
        recordRevision: payload.lastUpdated,
        changedPaths: task.syncContract?.changedPaths || [],
        mutationId: task.syncContract?.mutationId,
      };
    } catch (error) {
      logger.warn('Failed to inspect pending daily record task', error);
      return null;
    }
  };

  const replacePendingDailyRecordSyncTaskWithLocalRecord = async (
    record: DailyRecord,
    meta?: Pick<SyncTask, 'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'>,
    expectedTask?: PendingDailyRecordSyncTaskIdentity
  ): Promise<boolean> => {
    try {
      await ensureReady();
      return await replacePendingTask(record, meta, expectedTask);
    } catch (error) {
      logger.warn('Failed to replace pending daily record task', error);
      return false;
    }
  };

  const adoptAuthoritativeDailyRecordAtomically = async (
    record: DailyRecord,
    buildReplacement: (
      localRecord: DailyRecord,
      pendingTask: SyncTask
    ) => { record: DailyRecord; task: SyncTask | null } | null
  ): Promise<DailyRecordAuthorityAdoptionResult> => {
    try {
      await ensureReady();
      if (!store.adoptAuthoritativeDailyRecord) return { status: 'blocked' };
      const result = await store.adoptAuthoritativeDailyRecord(
        record,
        getOwnerKey(),
        buildReplacement
      );
      if (result.status === 'replaced') triggerProcessing();
      return result;
    } catch (error) {
      logger.warn('Failed to atomically adopt authoritative daily record', error);
      return { status: 'blocked' };
    }
  };

  return {
    ackDailyRecordSyncTask,
    releaseDailyRecordPreOutboxHold,
    renewDailyRecordPreOutboxHold,
    getPendingDailyRecordSyncTaskSnapshot,
    replacePendingDailyRecordSyncTaskWithLocalRecord,
    adoptAuthoritativeDailyRecordAtomically,
  };
};
