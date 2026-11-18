import type {
  DailyRecordConflictSummary,
  DailyRecordWriteConsistencyState,
} from '@/services/repositories/contracts/dailyRecordConsistency';

export interface DailyRecordRecoveryDecision {
  consistencyState: DailyRecordWriteConsistencyState;
  conflictSummary: DailyRecordConflictSummary | null;
  observabilityTags: string[];
  userSafeMessage?: string;
}

export interface ConflictAutoMergeRecoveryResult {
  status: 'auto_merged' | 'not_possible';
}

export interface RemoteWriteRecoveryResult {
  status: 'auto_merged' | 'queued_for_retry' | 'unrecoverable' | 'throw';
  queuedForRetry: boolean;
  autoMerged: boolean;
  error?: unknown;
  decision: DailyRecordRecoveryDecision;
}
