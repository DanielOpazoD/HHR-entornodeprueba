import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { holdsDailyRecordProjection } from './dexieSyncQueueQuarantine';

/** Puts the paths of the writes still pending on a day on top of the server's version of it. */
export type PendingPathsOverRemote = (remote: DailyRecord, pending: SyncTask[]) => DailyRecord;

/**
 * SAVE-01: what a successful server read shows for a day that pending writes still hold. It is the
 * server's version with the paths of those writes on top, so the census shows other computers'
 * changes wherever this computer has nothing pending. A released or retired write adds no paths:
 * its edits are not part of the day. When the pending writes cannot be put on top (a write without
 * its paths, a bed or crib that changed patient, any error), the stored copy is `kept` as it is,
 * and the read must not present it as confirmed. A composed day keeps the stored copy's version,
 * the one its pending writes were written against. Read in the caller's `rw` transaction.
 */
export const composeServerDayWithPending = async (
  date: string,
  remote: DailyRecord,
  stored: DailyRecord,
  compose: PendingPathsOverRemote
): Promise<{ record: DailyRecord } | { kept: 'not_composable' }> => {
  const pending = (await hospitalDB.syncQueue.where('key').equals(`daily:${date}`).toArray())
    .filter(task => holdsDailyRecordProjection(task, date) && task.status !== 'RETIRED')
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
  try {
    return { record: { ...compose(remote, pending), lastUpdated: stored.lastUpdated } };
  } catch {
    // The pending paths cannot be placed on the server's day: the stored copy stays, unconfirmed.
    return { kept: 'not_composable' };
  }
};
