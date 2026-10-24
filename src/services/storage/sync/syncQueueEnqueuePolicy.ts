import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecordPatchWrite } from '@/services/storage/sync/syncQueuePorts';

export interface SyncQueueEnqueueOptions {
  deferProcessing?: boolean;
  holdForMs?: number;
  preOutboxHoldOwner?: string;
  preOutboxHoldReason?: 'awaiting_remote_ack';
  /** A daily-record patch write, applied again on the day's stored record. */
  patchWrite?: DailyRecordPatchWrite;
}

export const countActiveSyncTasks = (tasks: SyncTask[]): number =>
  tasks.filter(task => task.status === 'PENDING' || task.status === 'PROCESSING').length;

export const resolveSyncTaskNextAttemptAt = (
  now: number,
  options: SyncQueueEnqueueOptions
): number => (options.holdForMs && options.holdForMs > 0 ? now + options.holdForMs : 0);

export const resolvePreOutboxHoldState = (
  now: number,
  options: SyncQueueEnqueueOptions
): Partial<SyncTask> => {
  if (!options.preOutboxHoldOwner || !options.preOutboxHoldReason || !options.holdForMs) {
    return {};
  }

  return {
    preOutboxHoldState: 'AWAITING_REMOTE_ACK',
    preOutboxHoldOwner: options.preOutboxHoldOwner,
    preOutboxHoldReason: options.preOutboxHoldReason,
    preOutboxHoldUntil: now + options.holdForMs,
    preOutboxHoldHeartbeatAt: now,
  };
};
