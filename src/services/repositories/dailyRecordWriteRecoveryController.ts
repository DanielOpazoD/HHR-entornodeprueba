import { classifyConflictChangedContexts } from '@/services/repositories/conflictResolutionDomainPolicy';
import type { DailyRecordConflictSummary } from '@/services/repositories/contracts/dailyRecordConsistency';

export const resolveEffectiveChangedPaths = (changedPaths: string[]): string[] =>
  changedPaths.length > 0 ? changedPaths : ['*'];

export const resolveRetryOrigin = (
  changedPaths: string[]
): 'full_save_retry' | 'partial_update_retry' =>
  resolveEffectiveChangedPaths(changedPaths).includes('*')
    ? 'full_save_retry'
    : 'partial_update_retry';

export const buildRecoveryTaskMeta = (
  changedPaths: string[],
  origin: 'full_save_retry' | 'partial_update_retry' | 'conflict_auto_merge',
  expectedVersion?: string
) => {
  const effectiveChangedPaths = resolveEffectiveChangedPaths(changedPaths);
  return {
    contexts: classifyConflictChangedContexts(effectiveChangedPaths),
    origin,
    syncContract: {
      ...(expectedVersion ? { expectedVersion } : {}),
      changedPaths: effectiveChangedPaths,
    },
  };
};

export const buildDailyRecordConflictSummary = (
  localTimestamp: string | undefined,
  changedPaths: string[],
  kind: DailyRecordConflictSummary['kind'],
  message: string
): DailyRecordConflictSummary => ({
  kind,
  sourceOfTruth: kind === 'concurrency' ? 'local' : 'none',
  localTimestamp,
  changedPaths: resolveEffectiveChangedPaths(changedPaths),
  message,
});
