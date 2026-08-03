import { useCallback } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import { extractDeviceTextItems } from '../mapping/extractDeviceTextItems';
import {
  runClinicalFill,
  countClinicalFillEligiblePatients,
  type ClinicalFillSummary,
  type ClinicalFillPatchTarget,
  type HistoricalCudyrApplyResult,
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
import { resolveClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
import { createClinicalEnrichmentPersistenceStrategy } from './clinicalEnrichmentPersistenceStrategy';
import {
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';

interface UseRayenClinicalFillInput {
  nurseCatalog: string[];
  tensCatalog: string[];
  loadDailyRecord: (date: string) => Promise<DailyRecord>;
  patchDailyRecord: (patch: DailyRecordPatch, target: ClinicalFillPatchTarget) => Promise<unknown>;
  applyHistoricalCudyr: (
    encId: string,
    censusDay: string,
    cudyr: ImportedCudyr
  ) => Promise<HistoricalCudyrApplyResult>;
  applyHistoricalCudyrBatch?: (
    censusDay: string,
    items: HistoricalCudyrBatchItem[]
  ) => Promise<HistoricalCudyrBatchItemResult[]>;
  completeRun: (
    record: DailyRecord,
    summary: ClinicalFillSummary,
    staffingProposal?: NursingStaffingProposal | null,
    runId?: string
  ) => Promise<void>;
  onStaffingProposal: (proposal: NursingStaffingProposal, attemptId: number) => void;
  onSettled: () => void;
  createId: () => string;
}

/** Runs the best-effort per-patient clinical enrichment and persists aggregate run evidence. */
export const useRayenClinicalFill = ({
  nurseCatalog,
  tensCatalog,
  loadDailyRecord,
  patchDailyRecord,
  applyHistoricalCudyr,
  applyHistoricalCudyrBatch,
  completeRun,
  onStaffingProposal,
  onSettled,
  createId,
}: UseRayenClinicalFillInput) =>
  useCallback(
    async (record: DailyRecord): Promise<void> => {
      const requestedRunId = record.rayenSync?.runId;
      const queueKey = `${record.date}|${requestedRunId ?? 'untracked'}`;
      const outcome = await enqueueLatestRayenClinicalFill(queueKey, async () => {
        const requestedEligibleCount = countClinicalFillEligiblePatients(record);
        let freshRecord: DailyRecord;
        try {
          freshRecord = await loadDailyRecord(record.date);
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
        const auditRunId = requestedRunId ?? freshRecord.rayenSync?.runId;
        const eligibleCount = countClinicalFillEligiblePatients(freshRecord);
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
          const batchMode = resolveClinicalEnrichmentBatchMode();
          const persistenceStrategy = createClinicalEnrichmentPersistenceStrategy({
            mode: batchMode,
            record: freshRecord,
            applyPatch: operation =>
              patchDailyRecord(operation.patch, operation.target).then(() => undefined),
            refreshRecord: () => loadDailyRecord(freshRecord.date),
          });
          summary = await runClinicalFill(
            freshRecord,
            toIsoReportDate(freshRecord),
            {
              diagnosticRunId: auditRunId,
              fetchDeviceReport: requestDeviceReport,
              extractDeviceItems: extractDeviceTextItems,
              fetchHistoryScales: requestHistoryScales,
              fetchScalesForms: requestScalesReport,
              fetchCudyrCategories: () => requestCudyrCategories(15000),
              applyPatch: async (patch, target) => {
                await patchDailyRecord(patch, target);
              },
              persistenceStrategy,
              applyHistoricalCudyr,
              applyHistoricalCudyrBatch,
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
      });
      if (outcome === 'drained') onSettled();
    },
    [
      applyHistoricalCudyr,
      applyHistoricalCudyrBatch,
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
