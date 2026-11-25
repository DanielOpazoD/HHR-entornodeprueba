import type { guardAuthoringSession } from '@/services/session/authoringSession';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { RayenSyncStructuralReviewEvidence } from '@/types/domain/rayenSync';
import type { ClinicalFillSummary } from '../clinicalFillRunner';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import {
  isClinicalRetryToken,
  type ClinicalFillRequest,
  type ClinicalRetryToken,
  type ClinicalStageResult,
} from '../contracts/clinicalStageResult';
import { reconcileNursingShiftProposal } from '../domain/applyNursingShiftProposal';
import { collectClinicalFillCandidates } from '../domain/clinicalFillCandidates';
import { resolveClinicalEnrichmentBatchPolicyForRun } from '../domain/clinicalEnrichmentBatchMode';
import {
  buildClinicalRetryToken,
  buildStructuralReviewEvidence,
  resolveClinicalStageResult,
} from '../domain/clinicalStageResolution';
import {
  buildGlobalClinicalFillError,
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';
import { readClinicalFillDerivedView } from './clinicalFillDerivedView';
import {
  isConfirmedRayenCensusHandoff,
  type ConfirmedRayenCensusHandoff,
} from './rayenCensusPersistenceGuard';
import { endRayenFill } from './useRayenFillStatus';

export type ClinicalFillRunnerModule = typeof import('../clinicalFillRunner');
export type AuthoringSession = ReturnType<typeof guardAuthoringSession>;
export type AvailableRunPolicy = Exclude<
  ReturnType<typeof resolveClinicalEnrichmentBatchPolicyForRun>,
  'unavailable'
>;

export type CompleteClinicalFillRun = (
  record: DailyRecord,
  summary: ClinicalFillSummary,
  staffingProposal?: NursingStaffingProposal | null,
  runId?: string,
  options?: {
    retry?: boolean;
    checkSession?: () => void;
    structuralReview?: RayenSyncStructuralReviewEvidence;
  }
) => Promise<void>;

export interface ResolvedClinicalFillRequest {
  retryRequest: ClinicalRetryToken | null;
  source: DailyRecord | ConfirmedRayenCensusHandoff;
  confirmedHandoff: ConfirmedRayenCensusHandoff | null;
  structuralReview: RayenSyncStructuralReviewEvidence | undefined;
  record: DailyRecord;
  allowedClinicalEpisodeIds: readonly string[] | undefined;
  requestedRunId: string | undefined;
  queueKey: string;
}

export const withRevalidatedClinicalRecord = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord
): DailyRecord | ConfirmedRayenCensusHandoff =>
  isConfirmedRayenCensusHandoff(source) ? { ...source, record } : source;

/** Step 0: unpack the retry token, confirmed handoff, target episode scope, and queue key. */
export const resolveClinicalFillRequest = (
  request: ClinicalFillRequest
): ResolvedClinicalFillRequest => {
  const retryRequest = isClinicalRetryToken(request) ? request : null;
  const source: DailyRecord | ConfirmedRayenCensusHandoff = isClinicalRetryToken(request)
    ? request.source
    : request;
  const isConfirmedHandoff = isConfirmedRayenCensusHandoff(source);
  const confirmedHandoff = isConfirmedHandoff ? source : null;
  const structuralReview = buildStructuralReviewEvidence(confirmedHandoff);
  const record: DailyRecord = isConfirmedHandoff ? source.record : source;
  const allowedClinicalEpisodeIds =
    retryRequest?.pendingClinicalEpisodeIds ?? confirmedHandoff?.safeClinicalEpisodeIds;
  const requestedRunId = confirmedHandoff?.runId ?? record.rayenSync?.runId;
  const queueKey = `${record.date}|${requestedRunId ?? 'untracked'}|${
    retryRequest ? 'retry' : 'initial'
  }`;

  return {
    retryRequest,
    source,
    confirmedHandoff,
    structuralReview,
    record,
    allowedClinicalEpisodeIds,
    requestedRunId,
    queueKey,
  };
};

export type RevalidateClinicalFillOutcome =
  | { ok: false; result: ClinicalStageResult }
  | {
      ok: true;
      freshRecord: DailyRecord;
      fillRecord: DailyRecord;
      runPolicy: AvailableRunPolicy;
      auditRunId: string | undefined;
      eligibleCount: number;
      loadDay: () => Promise<DailyRecord>;
      isSuperseded: (day: DailyRecord) => boolean;
    };

/** Step 1: revalidate the target day, batch policy, and clinicalDerived overlay before reading sources. */
export const revalidateClinicalFillDay = async ({
  resolved,
  startedAfterQueue,
  runner,
  loadDailyRecord,
  completeRun,
  check,
}: {
  resolved: ResolvedClinicalFillRequest;
  startedAfterQueue: boolean;
  runner: ClinicalFillRunnerModule;
  loadDailyRecord: (date: string) => Promise<DailyRecord>;
  completeRun: CompleteClinicalFillRun;
  check: AuthoringSession['check'];
}): Promise<RevalidateClinicalFillOutcome> => {
  const { source, confirmedHandoff, record, allowedClinicalEpisodeIds, requestedRunId } = resolved;
  const requestedEligibleCount = runner.countClinicalFillEligiblePatients(
    record,
    allowedClinicalEpisodeIds
  );
  // Immediate fills use the accepted record; queued fills revalidate at dequeue time.
  let freshRecord = record;
  // D10: what the fill reads and rebuilds from. On a split day it carries the episode
  // documents; `freshRecord` stays the un-overlaid day for write bases, audit and retries.
  let fillRecord = record;
  let runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(freshRecord, requestedRunId);
  const hasConfirmedImmediateHandoff =
    confirmedHandoff?.runId === requestedRunId && !startedAfterQueue;
  // Every read in this run is of the requested day.
  const loadDay = () => loadDailyRecord(record.date);
  const isSuperseded = (day: DailyRecord): boolean => {
    if (!requestedRunId || day.rayenSync?.runId === requestedRunId) return false;
    reportRayenSyncWarning('clinical_fill_superseded', { runId: requestedRunId });
    return true;
  };

  try {
    if (!hasConfirmedImmediateHandoff || runPolicy === 'unavailable') {
      freshRecord = await loadDay();
      check();
      if (isSuperseded(freshRecord)) return { ok: false, result: { status: 'failed' } };
      runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(freshRecord, requestedRunId);
    }
    // A run that waits for its policy reads no episode document.
    if (runPolicy !== 'unavailable') {
      const view = await readClinicalFillDerivedView(freshRecord, loadDay);
      check();
      if (view.day !== freshRecord) {
        // A document was ahead of the day, so the day was read again from the server.
        freshRecord = view.day;
        if (isSuperseded(freshRecord)) return { ok: false, result: { status: 'failed' } };
        runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(freshRecord, requestedRunId);
      }
      fillRecord = view.record;
    }
  } catch (error) {
    check();
    const errorKind = classifyRayenSyncError(error);
    reportRayenSyncWarning('clinical_record_load_failed', {
      runId: requestedRunId,
      errorKind,
      issueReason: 'record_load_failed',
    });
    await completeRun(
      record,
      {
        total: requestedEligibleCount,
        patched: 0,
        errors: [buildGlobalClinicalFillError('clinical_record_load_failed')],
      },
      null,
      requestedRunId,
      { checkSession: check }
    ).catch(() => undefined);
    return {
      ok: false,
      result: {
        status: 'failed',
        retry: buildClinicalRetryToken(source, record, allowedClinicalEpisodeIds),
      },
    };
  }

  if (runPolicy === 'unavailable') {
    const eligibleCount = runner.countClinicalFillEligiblePatients(
      freshRecord,
      allowedClinicalEpisodeIds
    );
    reportRayenSyncWarning('clinical_fill_failed', {
      runId: requestedRunId,
      errorKind: 'policy_unavailable',
      patientCount: eligibleCount,
    });
    // The structural save can become visible before its run event during propagation.
    // Keep the run in its applied/pending state so the established retry path can resume it.
    return {
      ok: false,
      result: {
        status: 'failed',
        retry: buildClinicalRetryToken(
          withRevalidatedClinicalRecord(source, freshRecord),
          freshRecord,
          allowedClinicalEpisodeIds
        ),
      },
    };
  }

  return {
    ok: true,
    freshRecord,
    fillRecord,
    runPolicy,
    auditRunId: requestedRunId ?? freshRecord.rayenSync?.runId,
    eligibleCount: runner.countClinicalFillEligiblePatients(freshRecord, allowedClinicalEpisodeIds),
    loadDay,
    isSuperseded,
  };
};

/** Step 4: record completion evidence, emit staffing proposals, and close the fill attempt. */
export const finalizeClinicalFillRun = async ({
  resolved,
  freshRecord,
  auditRunId,
  summary,
  committedAuditRecord,
  historicalCudyrEpisodeIds,
  attemptId,
  completeRun,
  onStaffingProposal,
  check,
}: {
  resolved: ResolvedClinicalFillRequest;
  freshRecord: DailyRecord;
  auditRunId: string | undefined;
  summary: ClinicalFillSummary;
  committedAuditRecord: DailyRecord | null;
  historicalCudyrEpisodeIds: string[];
  attemptId: number;
  completeRun: CompleteClinicalFillRun;
  onStaffingProposal: (proposal: NursingStaffingProposal, attemptId: number) => void;
  check: AuthoringSession['check'];
}): Promise<ClinicalStageResult> => {
  const { retryRequest, source, confirmedHandoff, structuralReview, record } = resolved;
  const { allowedClinicalEpisodeIds, requestedRunId } = resolved;

  if (summary.errors.length > 0) {
    const affectedPatients = new Set(
      summary.errors.map(item => item.bedId).filter(bedId => bedId !== '*')
    ).size;
    reportRayenSyncWarning('clinical_fill_partial', {
      runId: auditRunId,
      issueCount: summary.errors.length,
      patientCount: affectedPatients,
    });
  }
  const reviewProposal = summary.staffingProposal
    ? reconcileNursingShiftProposal(freshRecord, summary.staffingProposal)
    : null;
  const failedPatients = new Set(
    summary.errors.map(item => item.bedId).filter(bedId => bedId !== '*')
  ).size;
  let completionFailed = false;
  try {
    await completeRun(
      committedAuditRecord ?? freshRecord,
      summary,
      reviewProposal,
      requestedRunId,
      {
        checkSession: check,
        ...(retryRequest || structuralReview
          ? { retry: retryRequest !== null, structuralReview }
          : {}),
      }
    );
  } catch {
    completionFailed = true;
  }
  check();
  endRayenFill(failedPatients, summary.errors.length > 0 || completionFailed, attemptId);
  if (reviewProposal) onStaffingProposal(reviewProposal, attemptId);
  return resolveClinicalStageResult(
    withRevalidatedClinicalRecord(source, freshRecord),
    freshRecord,
    allowedClinicalEpisodeIds,
    summary,
    completionFailed,
    confirmedHandoff?.safeClinicalEpisodeIds ??
      collectClinicalFillCandidates(record).map(candidate => candidate.patient.clinicalEpisodeId!),
    historicalCudyrEpisodeIds
  );
};
