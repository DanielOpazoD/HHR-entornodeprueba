import {
  hasSkippedPreviousDayCorrections,
  type ConfirmedRayenImportResult,
} from './confirmRayenImport';
import { applyRayenHistoricalCorrectionState } from './rayenCensusPersistenceGuard';
import type { ConfirmedRayenCensusApplyResult } from './useRayenCensusDiffApplication';

export const summarizeRayenStructuralCommit = (
  result: ConfirmedRayenImportResult<ConfirmedRayenCensusApplyResult>,
  requiresFreshCapture: boolean
) => {
  const structuralConflicts = Math.max(
    result.appliedDiff.conflicts.length,
    result.appliedDiff.summary.conflicts
  );
  const hasHistoricalFollowUp =
    result.historicalCorrectionsPending ||
    hasSkippedPreviousDayCorrections(result.appliedDiff, false) ||
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
