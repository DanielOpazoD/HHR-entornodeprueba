import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { SyncQueueAckError } from '@/services/storage/syncErrorCatalog';

export const shouldAdoptDailyRecordAck = (
  task: SyncTask,
  authoritativeRecord: DailyRecord,
  local: DailyRecord | undefined,
  hasUnresolvedWrites: boolean
): boolean => {
  const payload = task.payload as Partial<DailyRecord> | undefined;
  if (
    task.type !== 'UPDATE_DAILY_RECORD' ||
    task.key !== `daily:${authoritativeRecord.date}` ||
    payload?.date !== authoritativeRecord.date
  ) {
    throw new SyncQueueAckError(
      'sync_ack_invalid_record',
      'Sync queue: authority ACK does not match the claimed daily record.'
    );
  }
  if (hasUnresolvedWrites) {
    if (!local) {
      throw new SyncQueueAckError(
        'sync_ack_missing_projection',
        'Sync queue: unresolved writes have no local projection.'
      );
    }
    return false;
  }
  if (
    local &&
    local.lastUpdated !== payload.lastUpdated &&
    local.lastUpdated !== authoritativeRecord.lastUpdated
  ) {
    throw new SyncQueueAckError(
      'sync_ack_projection_conflict',
      'Sync queue: local projection changed before authority ACK.'
    );
  }
  return true;
};
