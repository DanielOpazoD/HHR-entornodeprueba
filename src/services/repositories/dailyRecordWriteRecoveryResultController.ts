import type { DailyRecordConflictSummary } from '@/services/repositories/contracts/dailyRecordConsistency';
import type { RemoteWriteRecoveryResult } from '@/services/repositories/contracts/dailyRecordWriteRecoveryResult';
import type { DailyRecordWriteReason } from '@/services/repositories/contracts/dailyRecordResults';

export const buildBlockedRecoveryResult = (input: {
  error: unknown;
  blockingReason: 'regression' | 'version_mismatch';
  conflictSummary: DailyRecordConflictSummary;
  userSafeMessage: string;
  observabilityTags: string[];
}): RemoteWriteRecoveryResult => ({
  status: 'throw',
  queuedForRetry: false,
  autoMerged: false,
  error: input.error,
  decision: {
    consistencyState:
      input.blockingReason === 'regression' ? 'blocked_regression' : 'blocked_version_mismatch',
    conflictSummary: input.conflictSummary,
    observabilityTags: input.observabilityTags,
    userSafeMessage: input.userSafeMessage,
  },
});

export const buildAutoMergedRecoveryResult = (
  conflictSummary: DailyRecordConflictSummary,
  userSafeMessage: string,
  observabilityTags: string[],
  reason?: DailyRecordWriteReason
): RemoteWriteRecoveryResult => ({
  status: 'auto_merged',
  queuedForRetry: true,
  autoMerged: true,
  decision: {
    consistencyState: 'auto_merged',
    conflictSummary,
    observabilityTags,
    reason,
    userSafeMessage,
  },
});

export const buildThrowUnrecoverableRecoveryResult = (input: {
  error: unknown;
  conflictSummary: DailyRecordConflictSummary;
  userSafeMessage: string;
  observabilityTags: string[];
}): RemoteWriteRecoveryResult => ({
  status: 'throw',
  queuedForRetry: false,
  autoMerged: false,
  error: input.error,
  decision: {
    consistencyState: 'unrecoverable',
    conflictSummary: input.conflictSummary,
    observabilityTags: input.observabilityTags,
    userSafeMessage: input.userSafeMessage,
  },
});

export const buildQueuedRetryRecoveryResult = (
  conflictSummary: DailyRecordConflictSummary | null,
  userSafeMessage: string,
  observabilityTags: string[],
  reason?: DailyRecordWriteReason
): RemoteWriteRecoveryResult => ({
  status: 'queued_for_retry',
  queuedForRetry: true,
  autoMerged: false,
  decision: {
    consistencyState: 'queued_for_retry',
    conflictSummary,
    observabilityTags,
    reason,
    userSafeMessage,
  },
});

export const buildUnrecoverableRecoveryResult = (
  conflictSummary: DailyRecordConflictSummary,
  userSafeMessage: string,
  observabilityTags: string[]
): RemoteWriteRecoveryResult => ({
  status: 'unrecoverable',
  queuedForRetry: false,
  autoMerged: false,
  decision: {
    consistencyState: 'unrecoverable',
    conflictSummary,
    observabilityTags,
    userSafeMessage,
  },
});
