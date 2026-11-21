import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  createDailyRecordReadResult,
  type DailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';

/** A listener answer from the Firestore cache: not proof of the server's day nor of its absence. */
export const createUnconfirmedDailyRecordSubscriptionResult = (
  date: string,
  record: DailyRecord | null
): DailyRecordReadResult =>
  createDailyRecordReadResult(date, record, record ? 'indexeddb' : 'not_found', {
    serverConfirmed: false,
  });

/** A listener answer carrying the server's day (`serverConfirmed: false` = served from cache). */
export const createServerDailyRecordSubscriptionResult = (
  date: string,
  record: DailyRecord,
  serverConfirmed = true
): DailyRecordReadResult =>
  createDailyRecordReadResult(date, record, 'firestore', { serverConfirmed });
