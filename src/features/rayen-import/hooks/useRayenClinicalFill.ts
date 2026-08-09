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
import {
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';
import {
  isConfirmedRayenCensusHandoff,
  type ConfirmedRayenCensusHandoff,
} from './rayenCensusPersistenceGuard';

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
  ) => Promise<HistoricalCudyrBatchItemResult[]>;
  completeRun: (
    record: DailyRecord,
    summary: ClinicalFillSummary,
    staffingProposal?: NursingStaffingProposal | null,
    runId?: string
  ) => Promise<void>;
  onStaffingProposal: (proposal: NursingStaffingProposal, attemptId: number) => void;
  onSettled: (runId?: string) => void;
  createId: () => string;
}

export const resolveClinicalFillDay = (
  source: DailyRecord | ConfirmedRayenCensusHandoff,
  record: DailyRecord
): string =>
  isConfirmedRayenCensusHandoff(source) ? source.clinicalDay : toIsoReportDate(record);

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
  onSettled,
  createId,
}: UseRayenClinicalFillInput) =>
  useCallback(
    async (source: DailyRecord | ConfirmedRayenCensusHandoff): Promise<void> => {
      const isConfirmedHandoff = isConfirmedRayenCensusHandoff(source);
      const confirmedHandoff = isConfirmedHandoff ? source : null;
      const record: DailyRecord = isConfirmedHandoff ? source.record : source;
      const allowedClinicalEpisodeIds = confirmedHandoff?.safeClinicalEpisodeIds;
      const requestedRunId = record.rayenSync?.runId;
      const queueKey = `${record.date}|${requestedRunId ?? 'untracked'}`;
      const outcome = await enqueueLatestRayenClinicalFill(
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
                return;
              }
              runPolicy = resolveClinicalEnrichmentBatchPolicyForRun(freshRecord, requestedRunId);
            } catch (error) {
              reportRayenSyncWarning('clinical_record_load_failed', {
                runId: requestedRunId,
                errorKind: classifyRayenSyncError(error),
              });
              await completeRun(
                record,
                {
                  total: requestedEligibleCount,
                  patched: 0,
                  errors: [{ bedId: '*', source: 'patch', message: 'clinical_record_load_failed' }],
                },
                null,
                requestedRunId
              ).catch(() => undefined);
              return;
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
            return;
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
                errors: [{ bedId: '*', source: 'patch', message: 'clinical_fill_busy' }],
              },
              null,
              requestedRunId
            ).catch(() => undefined);
            return;
          }
          const attemptId = getRayenFillAttemptId();

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
              errors: [{ bedId: '*', source: 'patch', message: 'unexpected_fill_failure' }],
            };
          }

          if (confirmedHandoff?.historicalCorrectionsPending) {
            summary.errors.push({
              bedId: '*',
              source: 'patch',
              message: 'historical_census_write_failed',
            });
          }
          if ((confirmedHandoff?.isolatedConflicts.length ?? 0) > 0) {
            summary.errors.push({
              bedId: '*',
              source: 'patch',
              message: 'structural_conflicts_pending',
            });
          }

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
            await completeRun(freshRecord, summary, reviewProposal, requestedRunId);
          } catch {
            completionFailed = true;
          }
          endRayenFill(failedPatients, summary.errors.length > 0 || completionFailed);
          if (reviewProposal) onStaffingProposal(reviewProposal, attemptId);
        }
      );
      // Task-level early exits still resolve through the queue. Only clear the shared UI state once
      // this attempt drained the queue; a queued newer run must keep the synchronization active.
      if (outcome === 'drained') onSettled(requestedRunId);
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
      onSettled,
      onStaffingProposal,
      patchDailyRecord,
    ]
  );
