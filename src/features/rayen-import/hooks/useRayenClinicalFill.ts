import { useCallback } from 'react';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { extractDeviceTextItems } from '../mapping/extractDeviceTextItems';
import type { ClinicalFillSummary } from '../clinicalFillRunner';
import type {
  HistoricalCudyrBatchItem,
  HistoricalCudyrBatchExecutionResult,
} from '../contracts/clinicalFillContracts';
import {
  beginRayenFill,
  endRayenFill,
  getRayenFillAttemptId,
  registerRayenFillAbort,
  reportRayenFillProgress,
} from './useRayenFillStatus';
import { toIsoReportDate } from './reportDateHelpers';
import { createClinicalFillReaders } from '../bridge/clinicalFillReaders';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import { reconcileNursingShiftProposal } from '../domain/applyNursingShiftProposal';
import { enqueueLatestRayenClinicalFill } from '../domain/rayenClinicalFillQueue';
import { resolveClinicalEnrichmentBatchPolicyForRun } from '../domain/clinicalEnrichmentBatchMode';
import type { RayenSyncStructuralReviewEvidence } from '@/types/domain/rayenSync';
import {
  buildGlobalClinicalFillError,
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';
import {
  isConfirmedRayenCensusHandoff,
  type ConfirmedRayenCensusHandoff,
} from './rayenCensusPersistenceGuard';
import {
  isClinicalRetryToken,
  type ClinicalFillRequest,
  type ClinicalStageResult,
} from '../contracts/clinicalStageResult';
import { collectClinicalFillCandidates } from '../domain/clinicalFillCandidates';
import {
  buildClinicalRetryToken,
  buildStructuralReviewEvidence,
  mergeClinicalRetrySummary,
  resolveClinicalStageResult,
} from '../domain/clinicalStageResolution';
import { readClinicalFillDerivedView } from './clinicalFillDerivedView';

interface UseRayenClinicalFillInput {
  nurseCatalog: string[];
  tensCatalog: string[];
  loadDailyRecord: (date: string) => Promise<DailyRecord>;
  loadCudyrIdentityContext?: (date: string) => Promise<DailyRecord | null>;
  applyHistoricalCudyrEnforcedBatch?: (
    sourceRecord: DailyRecord,
    censusDay: string,
    items: HistoricalCudyrBatchItem[],
    runId: string,
    checkSession?: () => void
  ) => Promise<HistoricalCudyrBatchExecutionResult>;
  completeRun: (
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
  onStaffingProposal: (proposal: NursingStaffingProposal, attemptId: number) => void;
  createId: () => string;
}

export const resolveClinicalFillDay = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord
): string => (isConfirmedRayenCensusHandoff(source) ? source.clinicalDay : toIsoReportDate(record));

const withRevalidatedClinicalRecord = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord
): DailyRecord | ConfirmedRayenCensusHandoff =>
  isConfirmedRayenCensusHandoff(source) ? { ...source, record } : source;

/** Runs the best-effort per-patient clinical enrichment and persists aggregate run evidence. */
export const useRayenClinicalFill = ({
  nurseCatalog,
  tensCatalog,
  loadDailyRecord,
  loadCudyrIdentityContext,
  applyHistoricalCudyrEnforcedBatch,
  completeRun,
  onStaffingProposal,
  createId,
}: UseRayenClinicalFillInput) =>
  useCallback(
    async (request: ClinicalFillRequest): Promise<ClinicalStageResult> => {
      const owner = getStoredSessionOwnerKey(),
        generation = getSessionGeneration();
      const sessionChanged = () =>
        owner !== getStoredSessionOwnerKey() || generation !== getSessionGeneration();
      const check = () => {
        if (sessionChanged()) throw new Error('La sesión cambió.');
      };
      let activeAttemptId: number | undefined;
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
      const queued = await enqueueLatestRayenClinicalFill(
        record.date,
        queueKey,
        async ({ startedAfterQueue }) => {
          try {
            check();
            // The watchdog only exists while a fill runs, so it ships with the on-demand runner
            // chunk (outside the PWA precache) instead of the authenticated shell.
            const {
              countClinicalFillEligiblePatients,
              createClinicalFillWatchdog,
              runClinicalFill,
              collectDailyCudyrRecoveryEpisodes,
              createDailyCudyrRecoveryReader,
            } = await import('../clinicalFillRunner');
            check();
            const requestedEligibleCount = countClinicalFillEligiblePatients(
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
            const isSuperseded = (day: DailyRecord): boolean => {
              if (!requestedRunId || day.rayenSync?.runId === requestedRunId) return false;
              reportRayenSyncWarning('clinical_fill_superseded', { runId: requestedRunId });
              return true;
            };
            try {
              if (!hasConfirmedImmediateHandoff || runPolicy === 'unavailable') {
                freshRecord = await loadDailyRecord(record.date);
                check();
                if (isSuperseded(freshRecord)) return { status: 'failed' };
                runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(freshRecord, requestedRunId);
              }
              // A run that waits for its policy reads no episode document.
              if (runPolicy !== 'unavailable') {
                const view = await readClinicalFillDerivedView(freshRecord, () =>
                  loadDailyRecord(record.date)
                );
                check();
                if (view.day !== freshRecord) {
                  // A document was ahead of the day, so the day was read again from the server.
                  freshRecord = view.day;
                  if (isSuperseded(freshRecord)) return { status: 'failed' };
                  runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(
                    freshRecord,
                    requestedRunId
                  );
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
                status: 'failed',
                retry: buildClinicalRetryToken(source, record, allowedClinicalEpisodeIds),
              };
            }
            if (runPolicy === 'unavailable') {
              const eligibleCount = countClinicalFillEligiblePatients(
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
                status: 'failed',
                retry: buildClinicalRetryToken(
                  withRevalidatedClinicalRecord(source, freshRecord),
                  freshRecord,
                  allowedClinicalEpisodeIds
                ),
              };
            }
            const batchMode = runPolicy.clinicalBatchMode;
            const auditRunId = requestedRunId ?? freshRecord.rayenSync?.runId;
            const eligibleCount = countClinicalFillEligiblePatients(
              freshRecord,
              allowedClinicalEpisodeIds
            );
            if (!beginRayenFill(eligibleCount)) {
              await completeRun(
                freshRecord,
                {
                  total: eligibleCount,
                  patched: 0,
                  errors: [buildGlobalClinicalFillError('clinical_fill_busy')],
                },
                null,
                requestedRunId,
                { checkSession: check }
              ).catch(() => undefined);
              return {
                status: 'failed',
                retry: buildClinicalRetryToken(
                  withRevalidatedClinicalRecord(source, freshRecord),
                  freshRecord,
                  allowedClinicalEpisodeIds
                ),
              };
            }
            const attemptId = getRayenFillAttemptId();
            activeAttemptId = attemptId;
            const clinicalCandidates = collectClinicalFillCandidates(
              fillRecord,
              allowedClinicalEpisodeIds
            );
            const historicalCudyrEpisodeIds = collectDailyCudyrRecoveryEpisodes({
              acceptedRecord: record,
              currentRecord: fillRecord,
              conflicts: confirmedHandoff?.isolatedConflicts ?? [],
              pendingEpisodeIds: retryRequest?.pendingHistoricalCudyrEpisodeIds,
            });

            let summary: ClinicalFillSummary;
            const watchdog = createClinicalFillWatchdog({
              onTimeout: () =>
                reportRayenSyncWarning('clinical_fill_stage_timeout', { runId: auditRunId }),
            });
            registerRayenFillAbort(watchdog.abort, attemptId);
            try {
              const { createClinicalEnrichmentPersistenceStrategy } =
                await import('./clinicalEnrichmentPersistenceStrategy');
              check();
              const { registerEloisaStaff } = await import('@/services/staff/eloisaStaffRegistry');
              check();
              // The batch re-reads the day at its write turn: overlay that read too (D10).
              const refreshFillRecord = async (): Promise<DailyRecord> => {
                check();
                const day = await loadDailyRecord(freshRecord.date);
                check();
                const view = await readClinicalFillDerivedView(day, () =>
                  loadDailyRecord(freshRecord.date)
                );
                check();
                return view.record;
              };
              const persistenceStrategy = createClinicalEnrichmentPersistenceStrategy({
                checkSession: check,
                mode: batchMode,
                record: fillRecord,
                runId: runPolicy.runId,
                refreshRecord: refreshFillRecord,
                // After a committed batch the day is only refreshed, never rebuilt: no documents.
                refreshCommittedRecord: () => loadDailyRecord(freshRecord.date),
              });
              summary = await runClinicalFill(
                fillRecord,
                resolveClinicalFillDay(source, freshRecord),
                {
                  diagnosticRunId: auditRunId,
                  signal: watchdog.signal,
                  allowedClinicalEpisodeIds,
                  historicalCudyrEpisodeIds,
                  recoverMissingCudyr: createDailyCudyrRecoveryReader({
                    signal: watchdog.signal,
                    loadDay: loadCudyrIdentityContext ?? loadDailyRecord,
                  }),
                  pendingReads: retryRequest?.pendingReads,
                  ...createClinicalFillReaders(watchdog.signal, clinicalCandidates),
                  extractDeviceItems: extractDeviceTextItems,
                  persistenceStrategy,
                  applyHistoricalCudyrBatch: (censusDay, items) => {
                    check();
                    if (!applyHistoricalCudyrEnforcedBatch) {
                      throw new Error('El lote histórico autoritativo no está disponible.');
                    }
                    return applyHistoricalCudyrEnforcedBatch(
                      freshRecord,
                      censusDay,
                      items,
                      runPolicy.runId,
                      check
                    );
                  },
                  archiveCudyrCapture: request =>
                    import('@/services/cudyr/cudyrArchiveQueue').then(
                      ({ persistCudyrArchivePart }) => {
                        check();
                        return persistCudyrArchivePart(request, watchdog.signal, check);
                      }
                    ),
                  now: () => new Date(),
                  createId,
                  nurseCatalog,
                  tensCatalog,
                  registerStaff: observations => {
                    check();
                    return registerEloisaStaff(observations);
                  },
                },
                ({ done, total }) => reportRayenFillProgress(done, total, attemptId)
              );
            } catch (error) {
              check();
              reportRayenSyncWarning('clinical_fill_failed', {
                runId: auditRunId,
                errorKind: classifyRayenSyncError(error),
                patientCount: eligibleCount,
              });
              summary = {
                total: eligibleCount,
                patched: 0,
                errors: [buildGlobalClinicalFillError('unexpected_fill_failure')],
              };
            } finally {
              watchdog.settle();
              registerRayenFillAbort(null, attemptId);
            }

            check();
            summary = mergeClinicalRetrySummary(
              retryRequest?.previousSummary,
              summary,
              new Set(clinicalCandidates.map(candidate => candidate.bedId)),
              new Set([
                ...clinicalCandidates.map(({ patient }) => patient.clinicalEpisodeId!),
                ...historicalCudyrEpisodeIds,
              ])
            );

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
              await completeRun(freshRecord, summary, reviewProposal, requestedRunId, {
                checkSession: check,
                ...(retryRequest || structuralReview
                  ? { retry: retryRequest !== null, structuralReview }
                  : {}),
              });
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
                collectClinicalFillCandidates(record).map(
                  candidate => candidate.patient.clinicalEpisodeId!
                ),
              historicalCudyrEpisodeIds
            );
          } catch (error) {
            if (!sessionChanged()) throw error;
            if (activeAttemptId !== undefined) endRayenFill(0, true, activeAttemptId);
            return { status: 'failed' };
          }
        }
      );
      if (sessionChanged()) return { status: 'failed' };
      if (queued.result) return queued.result;
      return queued.outcome === 'superseded'
        ? { status: 'failed' }
        : {
            status: 'failed',
            retry: buildClinicalRetryToken(source, record, allowedClinicalEpisodeIds),
          };
    },
    [
      applyHistoricalCudyrEnforcedBatch,
      completeRun,
      createId,
      loadDailyRecord,
      loadCudyrIdentityContext,
      nurseCatalog,
      tensCatalog,
      onStaffingProposal,
    ]
  );
