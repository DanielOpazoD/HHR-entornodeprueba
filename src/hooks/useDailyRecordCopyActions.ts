import { useCallback } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { hasCriticalLegacyRepairSignal } from '@/hooks/controllers/legacyRepairWarningController';
import { buildCopyPatientNotifications } from '@/hooks/controllers/persistenceFeedbackController';
import { createScopedLogger } from '@/services/utils/loggerScope';

type CopyPatientToDateResultLike = {
  sourceDate: string;
  targetDate: string;
  sourceBedId: string;
  targetBedId: string;
  outcome: 'clean' | 'repaired';
  sourceCompatibilityIntensity:
    | 'none'
    | 'normalized_only'
    | 'legacy_staff_promoted'
    | 'legacy_schema_bridge';
  sourceMigrationRulesApplied: string[];
};

interface UseDailyRecordCopyActionsOptions {
  record: DailyRecord | null;
  refresh: () => void | Promise<void>;
  dailyRecord: {
    copyPatientToDateDetailed: (
      sourceDate: string,
      sourceBedId: string,
      targetDate: string,
      targetBedId: string
    ) => Promise<CopyPatientToDateResultLike>;
  };
  warning: (title: string, message?: string) => void;
}

const dailyRecordCopyLogger = createScopedLogger('useDailyRecordCopyActions');

export const useDailyRecordCopyActions = ({
  record,
  refresh,
  dailyRecord,
  warning,
}: UseDailyRecordCopyActionsOptions) =>
  useCallback(
    async (bedId: string, targetDate: string, targetBedId?: string) => {
      if (!record?.beds[bedId]?.patientName) return;

      try {
        const copyResult = await dailyRecord.copyPatientToDateDetailed(
          record.date,
          bedId,
          targetDate,
          targetBedId || bedId
        );
        const notifications = buildCopyPatientNotifications({
          outcome: copyResult.outcome,
          hasCriticalLegacyRepair: hasCriticalLegacyRepairSignal(copyResult),
        });
        for (const notification of notifications) {
          warning(notification.title, notification.message);
        }
        await refresh();
      } catch (error) {
        dailyRecordCopyLogger.error('Failed to copy patient to date', error);
        throw error;
      }
    },
    [dailyRecord, record, refresh, warning]
  );
