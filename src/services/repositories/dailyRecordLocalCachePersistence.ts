import {
  admitLocalRecords,
  type LocalRecordAdmissionCandidate,
  type LocalRecordAdmissionResult,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PendingPathsOverRemote } from '@/services/storage/sync/pendingDayComposition';
import { overlayPendingDailyRecordWrite } from '@/services/repositories/dailyRecordPendingWriteRebase';
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

/** A value with elements (a list, or an object holding some): the server may hold more of them. */
const hasElements = (value: unknown): boolean =>
  Array.isArray(value) ||
  (value !== null && typeof value === 'object' && Object.keys(value).length > 0);

/**
 * A pending path holding elements (devices, events, entries, movements, the extra beds, a whole
 * bed or crib, wherever it lives) whose server value is no longer the one the write was made on,
 * or whose base the write did not keep: putting the write's value on top could hide what the server
 * added, so the day cannot be shown with certainty. A scalar has no elements to hide and goes on top.
 */
const elementsChangedOnServer = (holder: SyncTask, remote: DailyRecord, path: string): boolean => {
  const bases = holder.patchBaseValues ?? {};
  const serverValue = getValueAtPath(remote, path);
  if (![getValueAtPath(holder.payload, path), bases[path], serverValue].some(hasElements))
    return false;
  return !Object.hasOwn(bases, path) || !hasSameComparableValue(serverValue, bases[path]);
};

/**
 * The server's day with each pending write's own paths on top, in order, exactly as each write
 * holds them (`overlayPendingDailyRecordWrite`); the tasks are not changed. Throws when a path
 * cannot be put on top with certainty, and the read then keeps its stored copy unconfirmed.
 */
const pendingPathsOverRemote: PendingPathsOverRemote = (remote, pending) =>
  pending.reduce((day, holder) => {
    const changedPaths = holder.syncContract?.changedPaths ?? [];
    if (changedPaths.some(path => elementsChangedOnServer(holder, remote, path)))
      throw new Error('A pending path with elements changed on the server.');
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
