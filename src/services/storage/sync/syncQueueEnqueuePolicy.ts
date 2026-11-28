import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecordPatchWrite } from '@/services/storage/sync/syncQueuePorts';
import type { AuthoringSession } from '@/services/session/authoringSession';

export interface SyncQueueEnqueueOptions {
  deferProcessing?: boolean;
  holdForMs?: number;
  preOutboxHoldOwner?: string;
  preOutboxHoldReason?: 'awaiting_remote_ack';
  /** A daily-record patch write, applied again on the day's stored record. */
  patchWrite?: DailyRecordPatchWrite;
  wholeRecordBase?: DailyRecord;
  /**
   * The refusal this write already met on the server. The task is stored held as that conflict,
   * as its replay would leave it, so the queue never sends it again only to meet the same refusal.
   */
  heldByConflict?: unknown;
  /** The session that began this write; the store keeps it with that owner if the session changed. */
  authoringSession: AuthoringSession;
}

export const resolveSyncTaskNextAttemptAt = (
  now: number,
  options: Omit<SyncQueueEnqueueOptions, 'authoringSession'>
): number => (options.holdForMs && options.holdForMs > 0 ? now + options.holdForMs : 0);

export const resolvePreOutboxHoldState = (
  now: number,
  options: Omit<SyncQueueEnqueueOptions, 'authoringSession'>
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
