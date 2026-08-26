import {
  committedRayenImportResultFromError,
  hasSkippedPreviousDayCorrections,
  type ConfirmedRayenImportResult,
} from './confirmRayenImport';
import { applyRayenHistoricalCorrectionState } from './rayenCensusPersistenceGuard';
import type { ConfirmedRayenCensusApplyResult } from './useRayenCensusDiffApplication';
import { defaultMonotonicNow, elapsedMilliseconds } from '../domain/rayenSyncPerformance';

export const summarizeRayenStructuralCommit = (
  result: ConfirmedRayenImportResult<ConfirmedRayenCensusApplyResult>,
  requiresFreshCapture: boolean,
  applyPreviousDays = false
) => {
  const structuralConflicts = Math.max(
    result.appliedDiff.conflicts.length,
    result.appliedDiff.summary.conflicts
  );
  const hasHistoricalFollowUp =
    result.historicalCorrectionsPending ||
    hasSkippedPreviousDayCorrections(result.appliedDiff, applyPreviousDays) ||
    requiresFreshCapture;
  const skippedItems = result.skipped.length + Number(hasHistoricalFollowUp);

  return {
    diff: result.appliedDiff,
    structuralConflicts,
    skippedItems,
    hasSkippedItems: skippedItems > 0,
    clinicalHandoff: applyRayenHistoricalCorrectionState(result.confirmedHandoff, {
      pending: result.historicalCorrectionsPending,
      requiresFreshCapture,
    }),
  };
};

export type RayenStructuralCommitSummary = ReturnType<typeof summarizeRayenStructuralCommit>;

export type RayenStructuralPersistenceOutcome =
  | {
      kind: 'applied' | 'applied_with_omissions';
      result: ConfirmedRayenImportResult<ConfirmedRayenCensusApplyResult>;
      commit: RayenStructuralCommitSummary;
    }
  | {
      kind: 'requires_fresh_capture';
      result: ConfirmedRayenImportResult<ConfirmedRayenCensusApplyResult>;
      commit: RayenStructuralCommitSummary;
      error: unknown;
    }
  | { kind: 'failed'; error: unknown };

/**
 * Executes the selected-day structural write and classifies its only terminal outcomes. A null
 * result means the originating sync execution is no longer current and must remain silent.
 */
export const executeRayenStructuralPersistence = async (
  persist: () => Promise<ConfirmedRayenImportResult<ConfirmedRayenCensusApplyResult> | null>,
  {
    applyPreviousDays = false,
    now = defaultMonotonicNow,
    onDuration,
  }: {
    applyPreviousDays?: boolean;
    now?: () => number;
    onDuration?: (durationMs: number) => void;
  } = {}
): Promise<RayenStructuralPersistenceOutcome | null> => {
  const startedAt = now();
  let persistenceAttempted = false;
  try {
    const result = await persist();
    if (!result) return null;
    persistenceAttempted = true;
    const commit = summarizeRayenStructuralCommit(result, false, applyPreviousDays);
    return {
      kind: commit.hasSkippedItems ? 'applied_with_omissions' : 'applied',
      result,
      commit,
    };
  } catch (error) {
    persistenceAttempted = true;
    const result = committedRayenImportResultFromError<ConfirmedRayenCensusApplyResult>(error);
    if (!result) return { kind: 'failed', error };
    return {
      kind: 'requires_fresh_capture',
      result,
      commit: summarizeRayenStructuralCommit(result, true, applyPreviousDays),
      error,
    };
  } finally {
    // Observability must never alter the structural outcome if its consumer fails.
    try {
      if (persistenceAttempted) onDuration?.(elapsedMilliseconds(startedAt, now()));
    } catch {
      // Best-effort aggregate telemetry only.
    }
  }
};
