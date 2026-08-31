import { useCallback } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import { extractDeviceTextItems } from '../mapping/extractDeviceTextItems';
import type {
  ClinicalFillSummary,
  ClinicalFillPatchTarget,
  HistoricalCudyrApplyResult,
} from '../clinicalFillRunner';
import type {
  HistoricalCudyrBatchItem,
  HistoricalCudyrBatchItemResult,
  HistoricalCudyrBatchExecutionResult,
} from '../contracts/clinicalFillContracts';
import {
  beginRayenFill,
  endRayenFill,
  getRayenFillAttemptId,
  reportRayenFillProgress,
} from './useRayenFillStatus';
import { toIsoReportDate } from './reportDateHelpers';
import {
  requestCudyrCategories,
  requestDeviceReport,
  requestHistoryScales,
  requestPatientClinicalBundle,
  requestScalesReport,
} from '../bridge/rayenImportBridge';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import { reconcileNursingShiftProposal } from '../domain/applyNursingShiftProposal';
import { enqueueLatestRayenClinicalFill } from '../domain/rayenClinicalFillQueue';
import {
  resolveClinicalEnrichmentBatchPolicyForRun,
  usesLegacyClinicalWriter,
} from '../domain/clinicalEnrichmentBatchMode';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
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

interface UseRayenClinicalFillInput {
  nurseCatalog: string[];
  tensCatalog: string[];
  loadDailyRecord: (date: string) => Promise<DailyRecord>;
  patchDailyRecord: (
    patch: DailyRecordPatch,
    target: ClinicalFillPatchTarget,
    writeGuard: RayenClinicalWriteGuard
  ) => Promise<unknown>;
  applyHistoricalCudyr: (
    encId: string,
    censusDay: string,
    cudyr: ImportedCudyr,
    writeGuard?: RayenClinicalWriteGuard
  ) => Promise<HistoricalCudyrApplyResult>;
  applyHistoricalCudyrBatch?: (
    censusDay: string,
    items: HistoricalCudyrBatchItem[],
    writeGuard?: RayenClinicalWriteGuard
  ) => Promise<HistoricalCudyrBatchItemResult[]>;
  applyHistoricalCudyrEnforcedBatch?: (
    sourceRecord: DailyRecord,
    censusDay: string,
    items: HistoricalCudyrBatchItem[],
    runId: string
  ) => Promise<HistoricalCudyrBatchExecutionResult>;
  completeRun: (
    record: DailyRecord,
    summary: ClinicalFillSummary,
    staffingProposal?: NursingStaffingProposal | null,
    runId?: string,
    options?: {
      retry?: boolean;
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
  isConfirmedRayenCensusHandoff(source) ? { ...source, record } : record;

/** Runs the best-effort per-patient clinical enrichment and persists aggregate run evidence. */
export const useRayenClinicalFill = ({
  nurseCatalog,
  tensCatalog,
  loadDailyRecord,
  patchDailyRecord,
  applyHistoricalCudyr,
  applyHistoricalCudyrBatch,
  applyHistoricalCudyrEnforcedBatch,
  completeRun,
  onStaffingProposal,
  createId,
}: UseRayenClinicalFillInput) =>
  useCallback(
    async (request: ClinicalFillRequest): Promise<ClinicalStageResult> => {
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
          const { countClinicalFillEligiblePatients, runClinicalFill } =
            await import('../clinicalFillRunner');
          const requestedEligibleCount = countClinicalFillEligiblePatients(
            record,
            allowedClinicalEpisodeIds
          );
          // The immediate path consumes the exact structural record just accepted by persistence.
          // A task that actually waited must revalidate once at dequeue time because a newer census
          // could have overtaken it while another clinical fill owned the queue.
          let freshRecord = record;
          let runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(freshRecord, requestedRunId);
          const hasConfirmedImmediateHandoff =
            confirmedHandoff?.runId === requestedRunId && !startedAfterQueue;
          if (!hasConfirmedImmediateHandoff || runPolicy === 'unavailable') {
            try {
              freshRecord = await loadDailyRecord(record.date);
              if (requestedRunId && freshRecord.rayenSync?.runId !== requestedRunId) {
                reportRayenSyncWarning('clinical_fill_superseded', {
                  runId: requestedRunId,
                });
                return { status: 'failed' };
              }
              runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(freshRecord, requestedRunId);
            } catch (error) {
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
                requestedRunId
              ).catch(() => undefined);
              return {
                status: 'failed',
                retry: buildClinicalRetryToken(source, record, allowedClinicalEpisodeIds),
              };
            }
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
          const legacyWriterEnabled = usesLegacyClinicalWriter(batchMode);
          const historicalWriteGuard: RayenClinicalWriteGuard | undefined = legacyWriterEnabled
            ? { ...runPolicy, recordScope: 'historical' }
            : undefined;
          const historicalCudyrPersistence = historicalWriteGuard
            ? {
                applyHistoricalCudyr: (encId: string, censusDay: string, cudyr: ImportedCudyr) =>
                  applyHistoricalCudyr(encId, censusDay, cudyr, historicalWriteGuard),
                applyHistoricalCudyrBatch: applyHistoricalCudyrBatch
                  ? (censusDay: string, items: HistoricalCudyrBatchItem[]) =>
                      applyHistoricalCudyrBatch(censusDay, items, historicalWriteGuard)
                  : undefined,
              }
            : {
                applyHistoricalCudyrBatch: (
                  censusDay: string,
                  items: HistoricalCudyrBatchItem[]
                ) => {
                  if (!applyHistoricalCudyrEnforcedBatch) {
                    throw new Error('El lote histórico autoritativo no está disponible.');
                  }
                  return applyHistoricalCudyrEnforcedBatch(
                    freshRecord,
                    censusDay,
                    items,
                    runPolicy.runId
                  );
                },
              };
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
              requestedRunId
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
          const retriedBedIds = new Set(
            collectClinicalFillCandidates(freshRecord, allowedClinicalEpisodeIds).map(
              candidate => candidate.bedId
            )
          );

          let summary: ClinicalFillSummary;
          try {
            const { createClinicalEnrichmentPersistenceStrategy } =
              await import('./clinicalEnrichmentPersistenceStrategy');
            const persistenceStrategy = createClinicalEnrichmentPersistenceStrategy({
              mode: batchMode,
              record: freshRecord,
              runId: runPolicy.runId,
              applyPatch: operation =>
                patchDailyRecord(operation.patch, operation.target, runPolicy).then(
                  () => undefined
                ),
              refreshRecord: () => loadDailyRecord(freshRecord.date),
            });
            summary = await runClinicalFill(
              freshRecord,
              resolveClinicalFillDay(source, freshRecord),
              {
                diagnosticRunId: auditRunId,
                allowedClinicalEpisodeIds,
                fetchDeviceReport: requestDeviceReport,
                extractDeviceItems: extractDeviceTextItems,
                fetchHistoryScales: requestHistoryScales,
                fetchScalesForms: requestScalesReport,
                fetchPatientClinicalBundle: requestPatientClinicalBundle,
                fetchCudyrCategories: () => requestCudyrCategories(15000),
                applyPatch: async (patch, target) => {
                  await patchDailyRecord(patch, target, runPolicy);
                },
                persistenceStrategy,
                ...historicalCudyrPersistence,
                now: () => new Date(),
                createId,
                nurseCatalog,
                tensCatalog,
              },
              ({ done, total }) => reportRayenFillProgress(done, total)
            );
          } catch (error) {
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
          }

          summary = mergeClinicalRetrySummary(
            retryRequest?.previousSummary,
            summary,
            retriedBedIds
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
            const completionOptions =
              retryRequest || structuralReview
                ? { retry: retryRequest !== null, structuralReview }
                : undefined;
            if (completionOptions) {
              await completeRun(
                freshRecord,
                summary,
                reviewProposal,
                requestedRunId,
                completionOptions
              );
            } else {
              await completeRun(freshRecord, summary, reviewProposal, requestedRunId);
            }
          } catch {
            completionFailed = true;
          }
          endRayenFill(failedPatients, summary.errors.length > 0 || completionFailed);
          if (reviewProposal) onStaffingProposal(reviewProposal, attemptId);
          return resolveClinicalStageResult(
            withRevalidatedClinicalRecord(source, freshRecord),
            freshRecord,
            allowedClinicalEpisodeIds,
            summary,
            completionFailed
          );
        }
      );
      if (queued.result) return queued.result;
      return queued.outcome === 'superseded'
        ? { status: 'failed' }
        : {
            status: 'failed',
            retry: buildClinicalRetryToken(source, record, allowedClinicalEpisodeIds),
          };
    },
    [
      applyHistoricalCudyr,
      applyHistoricalCudyrBatch,
      applyHistoricalCudyrEnforcedBatch,
      completeRun,
      createId,
      loadDailyRecord,
      nurseCatalog,
      tensCatalog,
      onStaffingProposal,
      patchDailyRecord,
    ]
  );
