import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { DailyRecordAuthorityCallableResponse } from './dailyRecordAuthorityCallableClient';

export interface DirectFirestoreWriteReceipt {
  recordState: NonNullable<DailyRecordAuthorityCallableResponse['recordState']>;
}

/** Builds a receipt for the exact record submitted by a completed direct Firestore transaction. */
export const createDirectFirestoreWriteReceipt = (
  record: DailyRecord,
  committedAt: Date
): DirectFirestoreWriteReceipt => {
  const lastUpdated = committedAt.toISOString();
  return {
    recordState: {
      lastUpdated,
      meta: {},
      record: { ...record, lastUpdated },
    },
  };
};
