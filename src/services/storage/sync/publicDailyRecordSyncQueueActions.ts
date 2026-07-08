import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueStorePort } from '@/services/storage/sync/syncQueuePorts';
import { recordSyncQueueAckFailure } from '@/services/storage/sync/syncQueueAckTelemetry';
import { getSyncTaskKey } from '@/services/storage/sync/syncQueueTaskFactory';

interface DailyRecordSyncQueueActionDependencies {
  ensureReady: () => Promise<void>;
  store: SyncQueueStorePort;
  getOwnerKey: () => string | null;
  logger: { warn: (message: string, error?: unknown) => void };
}

export const createDailyRecordSyncQueueActions = ({
  ensureReady,
  store,
  getOwnerKey,
  logger,
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

  return { ackDailyRecordSyncTask, releaseDailyRecordPreOutboxHold, renewDailyRecordPreOutboxHold };
};
