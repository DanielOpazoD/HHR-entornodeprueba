import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';

export interface PendingDailyRecordSyncTaskSnapshot {
  taskId: number;
  record: DailyRecord;
  recordRevision: string;
  changedPaths: string[];
  mutationId?: string;
}

export type PendingDailyRecordSyncTaskIdentity = Pick<
  PendingDailyRecordSyncTaskSnapshot,
  'taskId' | 'recordRevision' | 'mutationId'
>;
