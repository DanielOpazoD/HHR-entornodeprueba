import type { PublicWriteOptions } from '@/services/storage/authoringSession';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';

export type DailyRecordPatchMutationVariables =
  | DailyRecordPatch
  | {
      date?: string;
      partial: DailyRecordPatch;
      options?: PublicWriteOptions<PartialUpdateDailyRecordOptions>;
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

  const options = (variables as { options?: PublicWriteOptions<PartialUpdateDailyRecordOptions> })
    .options;
  const intentionalBedClear = options?.intentionalBedClear;
  if (!intentionalBedClear) return null;

  return {
    bedId: intentionalBedClear.bedId,
    target: intentionalBedClear.target === 'clinicalCrib' ? 'clinicalCrib' : 'bed',
  };
};

export interface PendingClinicalCribCreateTarget {
  bedId: string;
  /** Exact crib draft the guarded command sent; the census layer renders it verbatim. */
  crib: Record<string, unknown>;
}

/**
 * A clinical-crib creation is an exact, reversible guarded command. Its pending
 * mutation already carries the full crib draft in the patch, so the census can
 * project the provisional row the moment the user confirms, without waiting for
 * the per-date mutation turn that serializes the remote commit.
 */
export const resolvePendingClinicalCribCreateTarget = (
  variables: unknown
): PendingClinicalCribCreateTarget | null => {
  if (!variables || typeof variables !== 'object' || !('partial' in variables)) {
    return null;
  }

  const { partial, options } = variables as {
    partial: DailyRecordPatch;
    options?: PublicWriteOptions<PartialUpdateDailyRecordOptions>;
  };
  const clinicalCribCreate = options?.clinicalCribCreate;
  if (!clinicalCribCreate) return null;

  const crib = (partial as Record<string, unknown>)[
    `beds.${clinicalCribCreate.bedId}.clinicalCrib`
  ];
  if (!crib || typeof crib !== 'object' || Array.isArray(crib)) return null;

  return { bedId: clinicalCribCreate.bedId, crib: crib as Record<string, unknown> };
};
