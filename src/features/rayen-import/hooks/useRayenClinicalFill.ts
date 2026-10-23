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
  registerRayenFillAbort,
  reportRayenFillProgress,
} from './useRayenFillStatus';
import { selectHistoricalCudyrPersistence } from './historicalCudyrPersistenceSelection';
import { toIsoReportDate } from './reportDateHelpers';
import { createClinicalFillReaders } from '../bridge/clinicalFillReaders';
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
import { readClinicalFillDerivedView } from './clinicalFillDerivedView';

interface UseRayenClinicalFillInput {
  nurseCatalog: string[];
  tensCatalog: string[];
  loadDailyRecord: (date: string) => Promise<DailyRecord>;
  /** `baseRecord` is what the patch was computed from (its rebuild base), never a write base. */
  patchDailyRecord: (
    patch: DailyRecordPatch,
    target: ClinicalFillPatchTarget,
    writeGuard: RayenClinicalWriteGuard,
    baseRecord: DailyRecord
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
  isConfirmedRayenCensusHandoff(source) ? { ...source, record } : source;

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
          // The watchdog only exists while a fill runs, so it ships with the on-demand runner
          // chunk (outside the PWA precache) instead of the authenticated shell.
          const { countClinicalFillEligiblePatients, createClinicalFillWatchdog, runClinicalFill } =
            await import('../clinicalFillRunner');
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
              if (isSuperseded(freshRecord)) return { status: 'failed' };
              runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(freshRecord, requestedRunId);
            }
            // A run that waits for its policy reads no episode document.
            if (runPolicy !== 'unavailable') {
              const view = await readClinicalFillDerivedView(freshRecord, () =>
                loadDailyRecord(record.date)
              );
              if (view.day !== freshRecord) {
                // A document was ahead of the day, so the day was read again from the server.
                freshRecord = view.day;
                if (isSuperseded(freshRecord)) return { status: 'failed' };
                runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(freshRecord, requestedRunId);
              }
              fillRecord = view.record;
            }
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
          const historicalCudyrPersistence = selectHistoricalCudyrPersistence(
            { applyHistoricalCudyr, applyHistoricalCudyrBatch, applyHistoricalCudyrEnforcedBatch },
            historicalWriteGuard,
            freshRecord,
            runPolicy.runId
          );
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
          const clinicalCandidates = collectClinicalFillCandidates(
            fillRecord,
            allowedClinicalEpisodeIds
          );

          let summary: ClinicalFillSummary;
          const watchdog = createClinicalFillWatchdog({
            onTimeout: () =>
              reportRayenSyncWarning('clinical_fill_stage_timeout', { runId: auditRunId }),
          });
          registerRayenFillAbort(watchdog.abort, attemptId);
          try {
            const { createClinicalEnrichmentPersistenceStrategy } =
              await import('./clinicalEnrichmentPersistenceStrategy');
            const { registerEloisaStaff } = await import('@/services/staff/eloisaStaffRegistry');
            // The batch re-reads the day at its write turn: overlay that read too (D10).
            const refreshFillRecord = async (): Promise<DailyRecord> => {
              const day = await loadDailyRecord(freshRecord.date);
              const view = await readClinicalFillDerivedView(day, () =>
                loadDailyRecord(freshRecord.date)
              );
              return view.record;
            };
            const persistenceStrategy = createClinicalEnrichmentPersistenceStrategy({
              mode: batchMode,
              record: fillRecord,
              runId: runPolicy.runId,
              applyPatch: operation =>
                patchDailyRecord(operation.patch, operation.target, runPolicy, fillRecord).then(
                  () => undefined
                ),
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
                pendingReads: retryRequest?.pendingReads,
                ...createClinicalFillReaders(watchdog.signal, clinicalCandidates),
                extractDeviceItems: extractDeviceTextItems,
                applyPatch: async (patch, target) => {
                  await patchDailyRecord(patch, target, runPolicy, fillRecord);
                },
                persistenceStrategy,
                ...historicalCudyrPersistence,
                ...(batchMode === 'enforced'
                  ? {
                      archiveCudyrCapture: (
                        request: import('@/types/domain/cudyrHistory').ArchiveCudyrHistoryRequest
                      ) =>
                        import('@/services/cudyr/cudyrArchiveQueue').then(
                          ({ persistCudyrArchivePart }) =>
                            persistCudyrArchivePart(request, watchdog.signal)
                        ),
                    }
                  : {}),
                now: () => new Date(),
                createId,
                nurseCatalog,
                tensCatalog,
                registerStaff: registerEloisaStaff,
              },
              ({ done, total }) => reportRayenFillProgress(done, total, attemptId)
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
          } finally {
            watchdog.settle();
            registerRayenFillAbort(null, attemptId);
          }

          summary = mergeClinicalRetrySummary(
            retryRequest?.previousSummary,
            summary,
            new Set(clinicalCandidates.map(candidate => candidate.bedId)),
            new Set(clinicalCandidates.map(({ patient }) => patient.clinicalEpisodeId!))
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
              )
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
