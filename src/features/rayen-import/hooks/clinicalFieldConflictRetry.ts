import type { ClinicalFillError, ClinicalFillSummary } from '../contracts/clinicalFillContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';
import { addClinicalIncrementalMetrics } from '../domain/clinicalStageResolution';
import { collectClinicalFillCandidates } from '../domain/clinicalFillCandidates';
import { mergeRayenSyncPerformance } from '../domain/rayenSyncPerformance';
import {
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';
import { readClinicalFillDerivedView } from './clinicalFillDerivedView';

const isFieldConflict = (error: ClinicalFillError): boolean =>
  error.source === 'patch' && error.cause === 'batch_field_changed';

/** Episodes the batch left out because a clinical field changed after the run read its base. */
export const collectBatchFieldConflictEpisodeIds = (summary: ClinicalFillSummary): string[] => [
  ...new Set(
    summary.errors.flatMap(error =>
      isFieldConflict(error) && error.clinicalEpisodeId ? [error.clinicalEpisodeId] : []
    )
  ),
];

const clinicalFillErrorKey = (error: ClinicalFillError): string =>
  [error.bedId, error.clinicalEpisodeId, error.source, error.reason, error.cause].join('|');

/**
 * Folds the in-run retry of conflicted episodes into the attempt that left them out. The retry
 * resolves only their field conflict: it replaces those errors with its own, and every other issue
 * of the attempt, and its staffing inference, stay as they were.
 */
export const mergeClinicalConflictRetrySummary = (
  attempt: ClinicalFillSummary,
  retry: ClinicalFillSummary,
  retriedEpisodeIds: ReadonlySet<string>
): ClinicalFillSummary => {
  const errors = new Map<string, ClinicalFillError>();
  for (const error of [
    ...attempt.errors.filter(
      error => !(isFieldConflict(error) && retriedEpisodeIds.has(error.clinicalEpisodeId ?? ''))
    ),
    // Staffing comes from the attempt's whole census, so the retry's staffing issues do not apply.
    ...retry.errors.filter(error => error.source !== 'staffing'),
  ]) {
    if (!errors.has(clinicalFillErrorKey(error))) errors.set(clinicalFillErrorKey(error), error);
  }
  return {
    total: attempt.total,
    patched: Math.min(attempt.total, attempt.patched + retry.patched),
    errors: [...errors.values()],
    staffingProposal: attempt.staffingProposal,
    incremental: addClinicalIncrementalMetrics(attempt.incremental, retry.incremental),
    performance: mergeRayenSyncPerformance(attempt.performance, retry.performance),
  };
};

/**
 * On 2026-11-07 and 11-08 the next sync, a minute later, wrote every patient a field conflict had
 * left out. Retry them once through `fill`, merged on a fresh read of the day; a failed retry
 * leaves the attempt's pending issues as they were. Throws only when the session changed.
 * Positional, because every argument name would also ship in the eagerly loaded caller.
 */
export const retryFieldConflicts = async (
  summary: ClinicalFillSummary,
  runId: string | undefined,
  loadDay: () => Promise<DailyRecord>,
  isSuperseded: (day: DailyRecord) => boolean,
  check: () => void,
  /** Fills the episodes over the fresh day and its derived view, through the same batch. */
  fill: (
    day: DailyRecord,
    view: DailyRecord,
    episodeIds: string[],
    candidates: ReturnType<typeof collectClinicalFillCandidates>,
    conflictRetry: true
  ) => Promise<ClinicalFillSummary>,
  recordRunPerformance?: (delta: RayenSyncPerformanceDelta, runId?: string) => void
): Promise<ClinicalFillSummary> => {
  const conflictedEpisodeIds = collectBatchFieldConflictEpisodeIds(summary);
  if (conflictedEpisodeIds.length === 0) return summary;
  check();
  try {
    const day = await loadDay();
    check();
    const view = isSuperseded(day) ? null : await readClinicalFillDerivedView(day, loadDay);
    check();
    // The view re-reads the day when a document is ahead: that day must be this run's too.
    const candidates =
      view && (view.day === day || !isSuperseded(view.day))
        ? collectClinicalFillCandidates(view.record, conflictedEpisodeIds)
        : [];
    // An episode missing from the fresh day keeps its pending issue.
    const retriedEpisodeIds = candidates.map(({ patient }) => patient.clinicalEpisodeId!);
    if (!view || retriedEpisodeIds.length === 0) return summary;
    recordRunPerformance?.({ coordination: { clinicalRetries: 1 } }, runId);
    const retrySummary = await fill(view.day, view.record, retriedEpisodeIds, candidates, true);
    check();
    return mergeClinicalConflictRetrySummary(summary, retrySummary, new Set(retriedEpisodeIds));
  } catch (error) {
    check();
    reportRayenSyncWarning('clinical_fill_failed', {
      runId,
      errorKind: classifyRayenSyncError(error),
      patientCount: conflictedEpisodeIds.length,
    });
    return summary;
  }
};
