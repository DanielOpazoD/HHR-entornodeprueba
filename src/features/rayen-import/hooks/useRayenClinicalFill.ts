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
import { beginRayenFill, endRayenFill, reportRayenFillProgress } from './useRayenFillStatus';
import { toIsoReportDate } from './reportDateHelpers';
import {
  requestCudyrCategories,
  requestDeviceReport,
  requestHistoryScales,
  requestScalesReport,
} from '../bridge/rayenImportBridge';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import { hasNursingShiftSuggestions } from '../domain/inferNursingShifts';
import {
  hasNursingShiftReview,
  reconcileNursingShiftProposal,
} from '../domain/applyNursingShiftProposal';

interface UseRayenClinicalFillInput {
  nurseCatalog: string[];
  patchDailyRecord: (patch: DailyRecordPatch, target: ClinicalFillPatchTarget) => Promise<unknown>;
  applyHistoricalCudyr: (
    encId: string,
    censusDay: string,
    cudyr: ImportedCudyr
  ) => Promise<HistoricalCudyrApplyResult>;
  completeRun: (record: DailyRecord, summary: ClinicalFillSummary) => Promise<void>;
  onStaffingProposal: (proposal: NursingStaffingProposal) => void;
  onSettled: () => void;
  createId: () => string;
}

/** Runs the best-effort per-patient clinical enrichment and persists aggregate run evidence. */
export const useRayenClinicalFill = ({
  nurseCatalog,
  patchDailyRecord,
  applyHistoricalCudyr,
  completeRun,
  onStaffingProposal,
  onSettled,
  createId,
}: UseRayenClinicalFillInput) =>
  useCallback(
    async (record: DailyRecord): Promise<void> => {
      const eligibleCount = countClinicalFillEligiblePatients(record);
      if (!beginRayenFill(eligibleCount)) {
        // A deliberate run was already applied, so it must not remain indefinitely
        // at `applied` when the single-flight guard rejects its enrichment pass.
        try {
          await completeRun(record, {
            total: eligibleCount,
            patched: 0,
            errors: [{ bedId: '*', source: 'patch', message: 'clinical_fill_busy' }],
          });
        } catch (error) {
          console.warn('[rayen-import] cobertura de sincronización no registrada:', error);
        }
        onSettled();
        return;
      }

      let summary: ClinicalFillSummary;
      try {
        summary = await runClinicalFill(
          record,
          toIsoReportDate(record),
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
      if (summary.staffingProposal && hasNursingShiftSuggestions(summary.staffingProposal)) {
        const reviewProposal = reconcileNursingShiftProposal(record, summary.staffingProposal);
        if (hasNursingShiftReview(reviewProposal)) onStaffingProposal(reviewProposal);
      }
      const failedPatients = new Set(
        summary.errors.map(item => item.bedId).filter(bedId => bedId !== '*')
      ).size;
      endRayenFill(failedPatients);
      try {
        await completeRun(record, summary);
      } catch (error) {
        console.warn('[rayen-import] cobertura de sincronización no registrada:', error);
      }
      onSettled();
    },
    [
      applyHistoricalCudyr,
      completeRun,
      createId,
      nurseCatalog,
      onSettled,
      onStaffingProposal,
      patchDailyRecord,
    ]
  );
