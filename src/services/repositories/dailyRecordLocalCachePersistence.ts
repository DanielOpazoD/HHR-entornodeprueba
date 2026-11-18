import {
  admitLocalRecords,
  type LocalRecordAdmissionCandidate,
  type LocalRecordAdmissionResult,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PendingPathsOverRemote } from '@/services/storage/sync/pendingDayComposition';
import { overlayPendingDailyRecordWrite } from '@/services/repositories/dailyRecordPendingWriteRebase';
import { resolveDailyRecordSyncOwnership } from '@/services/repositories/dailyRecordSyncOwnershipPolicy';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

export type RemoteDailyRecordCandidate = LocalRecordAdmissionCandidate & {
  remoteRecord: DailyRecord | null;
};

export type RemoteDailyRecordAdmission = LocalRecordAdmissionResult & {
  remoteRecord: DailyRecord | null;
};

/**
 * A list merged by id (devices, clinical events, handoff entries, movements of the day) that the
 * server changed since the pending write was made on it: putting the write's list on top would hide
 * the server's items, so the day cannot be shown with certainty.
 */
const listChangedOnServer = (holder: SyncTask, remote: DailyRecord, path: string): boolean =>
  resolveDailyRecordSyncOwnership(path) === 'mergeById' &&
  (!Object.hasOwn(holder.patchBaseValues ?? {}, path) ||
    !hasSameComparableValue(getValueAtPath(remote, path), holder.patchBaseValues?.[path]));

/**
 * The server's day with each pending write's own paths on top, in order, exactly as each write
 * holds them (`overlayPendingDailyRecordWrite`); the tasks are not changed. Throws when a path
 * cannot be put on top with certainty, and the read then keeps its stored copy unconfirmed.
 */
const pendingPathsOverRemote: PendingPathsOverRemote = (remote, pending) =>
  pending.reduce((day, holder) => {
    const changedPaths = holder.syncContract?.changedPaths ?? [];
    if (changedPaths.some(path => listChangedOnServer(holder, remote, path)))
      throw new Error('A pending list changed on the server.');
    return overlayPendingDailyRecordWrite({
      authoritativeRecord: day,
      pendingTask: {
        taskId: holder.id ?? 0,
        record: holder.payload as DailyRecord,
        recordRevision: (holder.payload as DailyRecord).lastUpdated,
        changedPaths,
        mutationId: holder.syncContract?.mutationId,
      },
    });
  }, remote);

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
