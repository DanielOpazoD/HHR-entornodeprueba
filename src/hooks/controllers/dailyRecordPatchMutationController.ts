import type { DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';

export type DailyRecordPatchMutationVariables =
  | DailyRecordPatch
  | {
      partial: DailyRecordPatch;
      options?: PartialUpdateDailyRecordOptions;
    };

export const getDailyRecordPatchMutationKey = (date: string) => ['dailyRecordPatch', date] as const;

export interface PendingIntentionalClearTarget {
  bedId: string;
  target: 'bed' | 'clinicalCrib';
}

export const resolvePendingIntentionalClearTarget = (
  variables: unknown
): PendingIntentionalClearTarget | null => {
  if (!variables || typeof variables !== 'object' || !('partial' in variables)) {
    return null;
  }

  const options = (variables as { options?: PartialUpdateDailyRecordOptions }).options;
  const intentionalBedClear = options?.intentionalBedClear;
  if (!intentionalBedClear) return null;

  return {
    bedId: intentionalBedClear.bedId,
    target: intentionalBedClear.target === 'clinicalCrib' ? 'clinicalCrib' : 'bed',
  };
};
