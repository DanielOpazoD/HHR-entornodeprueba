import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  ackDailyRecordSyncTask,
  releaseDailyRecordPreOutboxHold,
  renewDailyRecordPreOutboxHold,
} from '@/services/storage/sync';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import {
  getPreOutboxRemoteAckHeartbeatMs,
  getPreOutboxRemoteAckLeaseMs,
} from '@/services/repositories/dailyRecordPreOutboxRemoteAckPolicy';

export const buildPreOutboxRemoteAckCallbacks = (
  record: DailyRecord,
  syncContract: SyncTaskContract
) => ({
  ackLocalAfterRemote: () => ackDailyRecordSyncTask(record, syncContract),
  releaseLocalPreOutboxHold: () =>
    releaseDailyRecordPreOutboxHold(record, syncContract).then(() => {}),
  renewLocalPreOutboxHold: () =>
    renewDailyRecordPreOutboxHold(record, syncContract, getPreOutboxRemoteAckLeaseMs()).then(
      () => {}
    ),
  renewLocalPreOutboxHoldEveryMs: getPreOutboxRemoteAckHeartbeatMs(),
});
