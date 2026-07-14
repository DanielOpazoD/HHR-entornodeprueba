import { useCallback } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { extractDeviceTextItems } from '../mapping/extractDeviceTextItems';
import { runClinicalFill, type ClinicalFillSummary } from '../clinicalFillRunner';
import { beginRayenFill, endRayenFill, reportRayenFillProgress } from './useRayenFillStatus';
import { toIsoReportDate } from './reportDateHelpers';
import {
  requestCudyrCategories,
  requestDeviceReport,
  requestHistoryScales,
  requestScalesReport,
} from '../bridge/rayenImportBridge';

interface UseRayenClinicalFillInput {
  patchDailyRecord: (patch: DailyRecordPatch) => Promise<unknown>;
  completeRun: (record: DailyRecord, summary: ClinicalFillSummary) => Promise<void>;
  onSettled: () => void;
  createId: () => string;
}

/** Runs the best-effort per-patient clinical enrichment and persists aggregate run evidence. */
export const useRayenClinicalFill = ({
  patchDailyRecord,
  completeRun,
  onSettled,
  createId,
}: UseRayenClinicalFillInput) =>
  useCallback(
    async (record: DailyRecord): Promise<void> => {
      const eligibleCount = Object.values(record.beds).filter(
        patient => !!patient?.clinicalEpisodeId && !!patient.patientName?.trim()
      ).length;
      if (!beginRayenFill(eligibleCount)) return;

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
            applyPatch: async patch => {
              await patchDailyRecord(patch);
            },
            now: () => new Date(),
            createId,
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
    [completeRun, createId, onSettled, patchDailyRecord]
  );
