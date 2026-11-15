import {
  createAutoMergeDecision,
  createBlockedDecision,
  createQueuedRetryDecision,
  createUnrecoverableDecision,
} from '@/services/repositories/dailyRecordRecoveryPolicy';
import type { DailyRecordConflictSummary } from '@/services/repositories/contracts/dailyRecordConsistency';
import type { RemoteWriteRecoveryResult } from '@/services/repositories/contracts/dailyRecordWriteRecoveryResult';

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
  decision: createBlockedDecision(
    input.blockingReason,
    input.conflictSummary,
    input.observabilityTags,
    input.userSafeMessage
  ),
});

export const buildAutoMergedRecoveryResult = (
  conflictSummary: DailyRecordConflictSummary,
  userSafeMessage: string,
  observabilityTags: string[]
): RemoteWriteRecoveryResult => ({
  status: 'auto_merged',
  queuedForRetry: true,
  autoMerged: true,
  decision: createAutoMergeDecision(conflictSummary, observabilityTags, userSafeMessage),
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
  decision: createUnrecoverableDecision(
    input.conflictSummary,
    input.observabilityTags,
    input.userSafeMessage
  ),
});

export const buildQueuedRetryRecoveryResult = (
  conflictSummary: DailyRecordConflictSummary | null,
  userSafeMessage: string,
  observabilityTags: string[]
): RemoteWriteRecoveryResult => ({
  status: 'queued_for_retry',
  queuedForRetry: true,
  autoMerged: false,
  decision: createQueuedRetryDecision(conflictSummary, observabilityTags, userSafeMessage),
});

export const buildUnrecoverableRecoveryResult = (
  conflictSummary: DailyRecordConflictSummary,
  userSafeMessage: string,
  observabilityTags: string[]
): RemoteWriteRecoveryResult => ({
  status: 'unrecoverable',
  queuedForRetry: false,
  autoMerged: false,
  decision: createUnrecoverableDecision(conflictSummary, observabilityTags, userSafeMessage),
});
