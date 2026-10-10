import { needsClinicalRead } from '../contracts/clinicalReadSelection';
import type { ClinicalFillSummary } from '../contracts/clinicalFillContracts';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ClinicalRetryToken, ClinicalStageResult } from '../contracts/clinicalStageResult';
import type { ConfirmedRayenCensusHandoff } from '../hooks/rayenCensusPersistenceGuard';
import {
  MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES,
  type RayenSyncStructuralReviewEvidence,
} from '@/types/domain/rayenSync';
import { selectClinicalRetryReads } from './clinicalRetryReadSelection';
import { collectClinicalFillCandidates } from './clinicalFillCandidates';
import { mergeRayenSyncPerformance } from './rayenSyncPerformance';

export const buildClinicalRetryToken = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord,
  allowedClinicalEpisodeIds: readonly string[] | undefined,
  failedBedIds?: ReadonlySet<string>,
  previousSummary?: ClinicalFillSummary,
  completionFailed = false,
  clinicalCohortEpisodeIds = allowedClinicalEpisodeIds
): ClinicalRetryToken => {
  const candidates = collectClinicalFillCandidates(record, allowedClinicalEpisodeIds);
  let pending = candidates.filter(candidate => !failedBedIds || failedBedIds.has(candidate.bedId));
  let pendingReads =
    !completionFailed && previousSummary
      ? selectClinicalRetryReads(candidates, previousSummary.errors)
      : undefined;
  if (
    previousSummary &&
    pending.some(({ patient }) =>
      needsClinicalRead(pendingReads, patient.clinicalEpisodeId!, 'history')
    )
  ) {
    const cohort = collectClinicalFillCandidates(record, clinicalCohortEpisodeIds);
    const pendingIds = new Set(pending.map(({ patient }) => patient.clinicalEpisodeId));
    // Staffing is inferred for the entire confirmed census. Recover its history cohort,
    // while other successful sources remain omitted for these additional episodes.
    const expandedReads = { ...pendingReads };
    for (const { patient } of cohort) {
      if (!completionFailed && !pendingIds.has(patient.clinicalEpisodeId)) {
        expandedReads[patient.clinicalEpisodeId!] = ['history'];
      }
    }
    pending = cohort;
    pendingReads = Object.keys(expandedReads).length ? expandedReads : undefined;
  }
  return {
    type: 'clinical_retry',
    source,
    pendingClinicalEpisodeIds: [
      ...new Set(pending.map(candidate => candidate.patient.clinicalEpisodeId!)),
    ],
    ...(previousSummary ? { previousSummary } : {}),
    ...(pendingReads ? { pendingReads } : {}),
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
  const issues = handoff.isolatedConflicts
    .slice(0, MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES)
    .map(conflict => ({
      bedId: conflict.bedId,
      reason: conflict.code ?? ('unclassified' as const),
      ...(conflict.caseContext
        ? {
            caseContext: {
              patientName: conflict.caseContext.patientName,
              censusDate: conflict.caseContext.censusDate,
              bedId: conflict.caseContext.bedId,
              isClinicalCrib: conflict.caseContext.isClinicalCrib === true,
            },
          }
        : {}),
    }));
  const deferredHistoricalAdmissionBedIds = handoff.deferredHistoricalAdmissionBedIds?.slice(
    0,
    MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES
  );
  return {
    structureConfirmed: true,
    historicalCorrectionsPending: handoff.historicalCorrectionsPending === true,
    historicalCorrectionsRequireFreshCapture:
      handoff.historicalCorrectionsRequireFreshCapture === true,
    isolatedConflicts: handoff.isolatedConflicts.length,
    ...(deferredHistoricalAdmissionBedIds?.length ? { deferredHistoricalAdmissionBedIds } : {}),
    ...(issues.length > 0 ? { issues } : {}),
  };
};

export const resolveClinicalStageResult = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord,
  allowedClinicalEpisodeIds: readonly string[] | undefined,
  summary: ClinicalFillSummary,
  completionFailed: boolean,
  clinicalCohortEpisodeIds?: readonly string[]
): ClinicalStageResult => {
  if (summary.errors.length === 0 && !completionFailed) return { status: 'complete' };
  const hasRetryableCudyrOutage = summary.errors.some(
    error => error.bedId === '*' && (error.source === 'cudyr' || error.source === 'bed_history')
  );
  const hasGlobalFailure = completionFailed || summary.errors.some(error => error.bedId === '*');
  const hasTerminalGlobalFailure =
    completionFailed ||
    summary.errors.some(
      error => error.bedId === '*' && error.source !== 'cudyr' && error.source !== 'bed_history'
    );
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
    summary,
    completionFailed,
    clinicalCohortEpisodeIds
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
