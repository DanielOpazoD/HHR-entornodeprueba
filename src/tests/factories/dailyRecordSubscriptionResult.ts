import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  createSyncDailyRecordResult,
  type SyncDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';

export const createUnconfirmedDailyRecordSubscriptionResult = (
  date: string,
  record: DailyRecord | null
): SyncDailyRecordResult =>
  createSyncDailyRecordResult({
    date,
    record,
    outcome: record ? 'clean' : 'missing',
    consistencyState: record ? 'up_to_date' : 'missing_remote',
    sourceOfTruth: record ? 'local' : 'none',
    serverConfirmed: false,
    retryability: 'not_applicable',
    recoveryAction: 'none',
    conflictSummary: null,
  });
