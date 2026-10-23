import { saveDetailed as saveDailyRecordDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { logAuditEvent } from '@/services/admin/auditService';
import { getCurrentUserEmail } from '@/services/admin/utils/auditUtils';
import { dataMaintenanceLogger } from '@/services/admin/adminLoggers';
import { buildAdmissionDateBackfillPlan } from '@/services/admin/admissionDateBackfillPlanner';
import type { AdmissionDateBackfillResult } from '@/services/admin/admissionDateBackfillTypes';
export type {
  AdmissionDateBackfillResult,
  AdmissionDateBackfillSample,
} from '@/services/admin/admissionDateBackfillTypes';

const summarizeBackfillPlan = (
  plan: Awaited<ReturnType<typeof buildAdmissionDateBackfillPlan>>
) => {
  const correctionCount = plan.records.reduce((total, item) => total + item.corrections.length, 0);
  const samples = plan.records.flatMap(item => item.corrections).slice(0, 10);

  return {
    correctionCount,
    samples,
  };
};

export const auditAdmissionDateBackfill = async (): Promise<AdmissionDateBackfillResult> => {
  try {
    const plan = await buildAdmissionDateBackfillPlan();
    const { correctionCount, samples } = summarizeBackfillPlan(plan);
    const outcome = correctionCount > 0 ? 'repaired' : 'clean';

    return {
      scannedDays: plan.scannedDays,
      reviewedEntries: plan.reviewedEntries,
      correctionCount,
      touchedRecords: plan.records.length,
      appliedRecords: 0,
      failedRecords: 0,
      outcome,
      samples,
      userSafeMessage:
        correctionCount > 0
          ? 'Se detectaron fechas de ingreso inconsistentes. Puede aplicar la corrección masiva.'
          : 'No se detectaron fechas de ingreso inconsistentes.',
    };
  } catch (error) {
    dataMaintenanceLogger.error('Admission date backfill audit failed', error);
    return {
      scannedDays: 0,
      reviewedEntries: 0,
      correctionCount: 0,
      touchedRecords: 0,
      appliedRecords: 0,
      failedRecords: 0,
      outcome: 'blocked',
      samples: [],
      userSafeMessage:
        error instanceof Error
          ? error.message
          : 'No se pudo auditar las fechas de ingreso históricas.',
    };
  }
};

// === APPLY BACKFILL ===

export const applyAdmissionDateBackfill = async (
  onProgress?: (current: number, total: number) => void
): Promise<AdmissionDateBackfillResult> => {
  try {
    const plan = await buildAdmissionDateBackfillPlan();
    let appliedRecords = 0;
    let failedRecords = 0;

    for (let index = 0; index < plan.records.length; index += 1) {
      const item = plan.records[index];
      try {
        // A bulk rewrite of past days keeps each day's previous state in history.
        await saveDailyRecordDetailed(item.record, undefined, { historyPolicy: 'snapshot' });
        appliedRecords += 1;
      } catch (error) {
        failedRecords += 1;
        dataMaintenanceLogger.error(
          `Failed to backfill admission dates for ${item.record.date}`,
          error
        );
      }

      if (onProgress) {
        onProgress(index + 1, plan.records.length);
      }
    }

    const { correctionCount, samples } = summarizeBackfillPlan(plan);
    const outcome =
      correctionCount === 0
        ? 'clean'
        : appliedRecords === 0
          ? 'blocked'
          : failedRecords > 0
            ? 'partial'
            : 'repaired';

    if (appliedRecords > 0) {
      await logAuditEvent(
        getCurrentUserEmail(),
        'DATA_ADMISSION_DATES_BACKFILLED',
        'dailyRecord',
        'historical-admission-dates',
        {
          scannedDays: plan.scannedDays,
          reviewedEntries: plan.reviewedEntries,
          correctionCount,
          touchedRecords: plan.records.length,
          appliedRecords,
          failedRecords,
          outcome,
          samples,
        }
      );
    }

    return {
      scannedDays: plan.scannedDays,
      reviewedEntries: plan.reviewedEntries,
      correctionCount,
      touchedRecords: plan.records.length,
      appliedRecords,
      failedRecords,
      outcome,
      samples,
      userSafeMessage:
        correctionCount > 0
          ? failedRecords > 0
            ? 'Se aplicó la corrección histórica con algunos fallos.'
            : 'Se aplicó la corrección histórica de fechas de ingreso.'
          : 'No había fechas de ingreso para corregir.',
    };
  } catch (error) {
    dataMaintenanceLogger.error('Admission date backfill failed', error);
    return {
      scannedDays: 0,
      reviewedEntries: 0,
      correctionCount: 0,
      touchedRecords: 0,
      appliedRecords: 0,
      failedRecords: 0,
      outcome: 'blocked',
      samples: [],
      userSafeMessage:
        error instanceof Error
          ? error.message
          : 'No se pudo aplicar la corrección histórica de fechas de ingreso.',
    };
  }
};
