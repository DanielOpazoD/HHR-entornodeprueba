import type { ClinicalFillSummary } from '../contracts/clinicalFillContracts';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ClinicalRetryToken, ClinicalStageResult } from '../contracts/clinicalStageResult';
import type { ConfirmedRayenCensusHandoff } from '../hooks/rayenCensusPersistenceGuard';
import type { RayenSyncStructuralReviewEvidence } from '@/types/domain/rayenSync';
import { collectClinicalFillCandidates } from './clinicalFillCandidates';
import { mergeRayenSyncPerformance } from './rayenSyncPerformance';

export const buildClinicalRetryToken = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord,
  allowedClinicalEpisodeIds: readonly string[] | undefined,
  failedBedIds?: ReadonlySet<string>,
  previousSummary?: ClinicalFillSummary
): ClinicalRetryToken => {
  const candidates = collectClinicalFillCandidates(record, allowedClinicalEpisodeIds);
  return {
    type: 'clinical_retry',
    source,
    pendingClinicalEpisodeIds: candidates
      .filter(candidate => !failedBedIds || failedBedIds.has(candidate.bedId))
      .map(candidate => candidate.patient.clinicalEpisodeId!)
      .filter((clinicalEpisodeId, index, values) => values.indexOf(clinicalEpisodeId) === index),
    ...(previousSummary ? { previousSummary } : {}),
  };
};

const addIncrementalMetrics = (
  previous: ClinicalFillSummary['incremental'],
  current: ClinicalFillSummary['incremental']
): ClinicalFillSummary['incremental'] => {
  if (!previous) return current;
  if (!current) return previous;
  return {
    received: previous.received + current.received,
    newFacts: previous.newFacts + current.newFacts,
    duplicates: previous.duplicates + current.duplicates,
    corrections: previous.corrections + current.corrections,
    patientWrites: previous.patientWrites + current.patientWrites,
    historySnapshots: previous.historySnapshots + current.historySnapshots,
    clinicalTargets: (previous.clinicalTargets ?? 0) + (current.clinicalTargets ?? 0),
    checkpointOnlyTargets:
      (previous.checkpointOnlyTargets ?? 0) + (current.checkpointOnlyTargets ?? 0),
    batch: current.batch ?? previous.batch,
  };
};

export const mergeClinicalRetrySummary = (
  previous: ClinicalFillSummary | undefined,
  current: ClinicalFillSummary,
  retriedBedIds: ReadonlySet<string>
): ClinicalFillSummary => {
  if (!previous) return current;
  const retainedErrors = previous.errors.filter(
    error => error.bedId !== '*' && !retriedBedIds.has(error.bedId)
  );
  return {
    total: previous.total,
    // A retry can repeat targets whose clinical write succeeded but whose audit
    // completion did not. Coverage is bounded by the original run population.
    patched: Math.min(previous.total, previous.patched + current.patched),
    errors: [...retainedErrors, ...current.errors],
    staffingProposal: current.staffingProposal ?? previous.staffingProposal,
    incremental: addIncrementalMetrics(previous.incremental, current.incremental),
    performance: mergeRayenSyncPerformance(previous.performance, current.performance),
  };
};

export const buildStructuralReviewEvidence = (
  handoff: ConfirmedRayenCensusHandoff | null
): RayenSyncStructuralReviewEvidence | undefined => {
  if (!handoff) return undefined;
  return {
    structureConfirmed: true,
    historicalCorrectionsPending: handoff.historicalCorrectionsPending === true,
    historicalCorrectionsRequireFreshCapture:
      handoff.historicalCorrectionsRequireFreshCapture === true,
    isolatedConflicts: handoff.isolatedConflicts.length,
  };
};

export const resolveClinicalStageResult = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord,
  allowedClinicalEpisodeIds: readonly string[] | undefined,
  summary: ClinicalFillSummary,
  completionFailed: boolean
): ClinicalStageResult => {
  if (summary.errors.length === 0 && !completionFailed) return { status: 'complete' };
  const hasRetryableCudyrOutage = summary.errors.some(
    error => error.bedId === '*' && error.source === 'cudyr'
  );
  const hasGlobalFailure = completionFailed || summary.errors.some(error => error.bedId === '*');
  const hasTerminalGlobalFailure =
    completionFailed ||
    summary.errors.some(error => error.bedId === '*' && error.source !== 'cudyr');
  const failedBedIds = hasGlobalFailure
    ? undefined
    : new Set(summary.errors.map(error => error.bedId));
  const eligibleCandidates = collectClinicalFillCandidates(record, allowedClinicalEpisodeIds);
  const eligibleEpisodeIds = new Set(
    eligibleCandidates.flatMap(candidate =>
      candidate.patient.clinicalEpisodeId ? [candidate.patient.clinicalEpisodeId] : []
    )
  );
  const failedEpisodeIds = new Set(
    summary.errors.flatMap(error =>
      error.clinicalEpisodeId && eligibleEpisodeIds.has(error.clinicalEpisodeId)
        ? [error.clinicalEpisodeId]
        : []
    )
  );
  const unscopedFailedBedIds = new Set(
    summary.errors.flatMap(error =>
      !error.clinicalEpisodeId && error.bedId !== '*' ? [error.bedId] : []
    )
  );
  for (const candidate of eligibleCandidates) {
    if (unscopedFailedBedIds.has(candidate.bedId) && candidate.patient.clinicalEpisodeId) {
      failedEpisodeIds.add(candidate.patient.clinicalEpisodeId);
    }
  }
  const retryRequest = buildClinicalRetryToken(
    source,
    record,
    allowedClinicalEpisodeIds,
    failedBedIds,
    summary
  );
  const hasCompletedTargets =
    summary.patched > 0 ||
    completionFailed ||
    (hasRetryableCudyrOutage && !hasTerminalGlobalFailure) ||
    (!hasGlobalFailure && failedEpisodeIds.size < eligibleEpisodeIds.size);
  return hasCompletedTargets
    ? { status: 'partial', retry: retryRequest }
    : { status: 'failed', retry: retryRequest };
};
