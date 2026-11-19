import { classifyConflictChangedContexts } from '@/services/repositories/conflictResolutionDomainPolicy';

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
