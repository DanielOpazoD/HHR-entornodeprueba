import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { RayenSyncStage } from './rayenSyncExecutionState';

/** Preserves main's no-change audit/checkpoint path, including conflict-only review plans. */
export const hasNoApplicableRayenStructuralChanges = (diff: CensusImportDiff): boolean => {
  const applicableChanges =
    diff.admissions.length +
    diff.updates.length +
    diff.moves.length +
    diff.discharges.length +
    (diff.reportEgresos?.length ?? 0);
  return applicableChanges === 0;
};

/** A conflict-only plan is already checkpointed, so closing its review must not cancel clinical work. */
export const resolveRayenSnapshotPlanningStage = (
  hasNoApplicableChanges: boolean,
  hasUnresolvedConflicts: boolean
): RayenSyncStage => {
  if (hasNoApplicableChanges) return { type: 'syncing_clinical' };
  if (hasUnresolvedConflicts) return { type: 'needs_review', scope: 'structure' };
  return { type: 'awaiting_review' };
};
