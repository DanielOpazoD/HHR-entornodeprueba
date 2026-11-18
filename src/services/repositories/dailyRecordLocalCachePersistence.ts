import {
  admitLocalRecords,
  type LocalRecordAdmissionCandidate,
  type LocalRecordAdmissionResult,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PendingPathsOverRemote } from '@/services/storage/sync/closedWindowDayRelease';
import { rebasePendingDailyRecordWrite } from '@/services/repositories/dailyRecordPendingWriteRebase';

export type RemoteDailyRecordCandidate = LocalRecordAdmissionCandidate & {
  remoteRecord: DailyRecord | null;
};

export type RemoteDailyRecordAdmission = LocalRecordAdmissionResult & {
  remoteRecord: DailyRecord | null;
};

/**
 * The server's day with each holding write's own paths on top, in order, as a confirmed command
 * adopts it (`rebasePendingDailyRecordWrite`); the tasks are not changed.
 */
const pendingPathsOverRemote: PendingPathsOverRemote = (remote, holders) =>
  holders.reduce(
    (day, holder) =>
      rebasePendingDailyRecordWrite({
        authoritativeRecord: day,
        pendingTask: {
          taskId: holder.id ?? 0,
          record: holder.payload as DailyRecord,
          recordRevision: (holder.payload as DailyRecord).lastUpdated,
          changedPaths: holder.syncContract?.changedPaths ?? [],
          mutationId: holder.syncContract?.mutationId,
        },
        alreadyAppliedPatch: {},
      }).record,
    remote
  );

/** All confirmed observations share one admission; remote evidence never acknowledges retained work. */
export const admitRemoteDailyRecords = async (
  candidates: readonly RemoteDailyRecordCandidate[]
): Promise<RemoteDailyRecordAdmission[]> => {
  const byDate = new Map(
    candidates.map(candidate => [
      candidate.record.date,
      { ...candidate, composeOverRemote: pendingPathsOverRemote },
    ])
  );
  const results = await admitLocalRecords([...byDate.values()]);
  return results.map(result => ({
    ...result,
    remoteRecord: byDate.get(result.date)?.remoteRecord ?? null,
  }));
};
