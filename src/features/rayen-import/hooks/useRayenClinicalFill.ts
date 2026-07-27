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
  completeRun: (
    record: DailyRecord,
    summary: ClinicalFillSummary,
    staffingProposal?: NursingStaffingProposal | null
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
  completeRun,
  onStaffingProposal,
  onSettled,
  createId,
}: UseRayenClinicalFillInput) =>
  useCallback(
    async (record: DailyRecord): Promise<void> => {
      const queueKey = `${record.date}|${record.rayenSync?.runId ?? 'untracked'}`;
      const outcome = await enqueueLatestRayenClinicalFill(queueKey, async () => {
        let freshRecord: DailyRecord;
        try {
          freshRecord = await loadDailyRecord(record.date);
        } catch (error) {
          console.warn('[rayen-import] no se pudo hidratar el censo antes del relleno:', error);
          return;
        }
        const eligibleCount = countClinicalFillEligiblePatients(freshRecord);
        if (!beginRayenFill(eligibleCount)) {
          return;
        }
        const attemptId = getRayenFillAttemptId();

        let summary: ClinicalFillSummary;
        try {
          summary = await runClinicalFill(
            freshRecord,
            toIsoReportDate(freshRecord),
            {
              fetchDeviceReport: requestDeviceReport,
              extractDeviceItems: extractDeviceTextItems,
              fetchHistoryScales: requestHistoryScales,
              fetchScalesForms: requestScalesReport,
              fetchCudyrCategories: () => requestCudyrCategories(15000),
              applyPatch: async (patch, target) => {
                await patchDailyRecord(patch, target);
              },
              applyHistoricalCudyr,
              now: () => new Date(),
              createId,
              nurseCatalog,
              tensCatalog,
            },
            ({ done, total }) => reportRayenFillProgress(done, total)
          );
        } catch (error) {
          console.warn('[rayen-import] Relleno clínico falló:', error);
          summary = {
            total: eligibleCount,
            patched: 0,
            errors: [{ bedId: '*', source: 'patch', message: 'unexpected_fill_failure' }],
          };
        }

        if (summary.errors.length > 0) {
          console.warn('[rayen-import] Relleno clínico con errores:', summary.errors);
        }
        const reviewProposal = summary.staffingProposal
          ? reconcileNursingShiftProposal(freshRecord, summary.staffingProposal)
          : null;
        const failedPatients = new Set(
          summary.errors.map(item => item.bedId).filter(bedId => bedId !== '*')
        ).size;
        let completionFailed = false;
        try {
          await completeRun(freshRecord, summary, reviewProposal);
        } catch (error) {
          completionFailed = true;
          console.warn('[rayen-import] cobertura de sincronización no registrada:', error);
        }
        endRayenFill(failedPatients, summary.errors.length > 0 || completionFailed);
        if (reviewProposal) onStaffingProposal(reviewProposal, attemptId);
      });
      if (outcome === 'drained') onSettled();
    },
    [
      applyHistoricalCudyr,
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
