import { BEDS } from '@/constants/beds';
import type { CudyrScore } from '@/types/domain/cudyr';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordCudyrState } from '@/types/domain/dailyRecordSlices';
import { isCudyrPatientEligible } from './cudyrEligibility';

export const CUDYR_SCORE_FIELDS = [
  'changeClothes',
  'mobilization',
  'feeding',
  'elimination',
  'psychosocial',
  'surveillance',
  'vitalSigns',
  'fluidBalance',
  'oxygenTherapy',
  'airway',
  'proInterventions',
  'skinCare',
  'pharmacology',
  'invasiveElements',
] as const satisfies readonly (keyof CudyrScore)[];

export const isCudyrScoreComplete = (score?: Partial<CudyrScore>): boolean =>
  Boolean(
    score &&
    CUDYR_SCORE_FIELDS.every(field => {
      const value = score[field];
      return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 3;
    })
  );

export interface CudyrRecordCompletion {
  eligibleCount: number;
  completedCount: number;
  isComplete: boolean;
}

export const hasValidCudyrSaveAttribution = (
  record: DailyRecord,
  options: { allowShiftDateNormalization?: boolean } = {}
): boolean =>
  (record.cudyrShiftDate === record.date || options.allowShiftDateNormalization === true) &&
  Boolean(record.cudyrUpdatedBy?.trim()) &&
  Boolean(record.cudyrUpdatedById?.trim()) &&
  Boolean(record.cudyrUpdatedAt && !Number.isNaN(Date.parse(record.cudyrUpdatedAt)));

export const resolveCudyrRecordCompletion = (
  record: DailyRecordCudyrState
): CudyrRecordCompletion => {
  let eligibleCount = 0;
  let completedCount = 0;
  const activeExtraBeds = new Set(record.activeExtraBeds || []);

  const countPatient = (patient: (typeof record.beds)[string] | undefined) => {
    if (!patient || !isCudyrPatientEligible(record.date, patient)) return;
    eligibleCount += 1;
    if (isCudyrScoreComplete(patient.cudyr)) completedCount += 1;
  };

  BEDS.forEach(bed => {
    if (bed.isExtra && !activeExtraBeds.has(bed.id)) return;
    const patient = record.beds[bed.id];
    countPatient(patient);
    countPatient(patient?.clinicalCrib);
  });

  return {
    eligibleCount,
    completedCount,
    isComplete: eligibleCount > 0 && completedCount === eligibleCount,
  };
};

/**
 * Promotes a complete CUDYR to its persisted closed state. This is deliberately
 * derived from the merged record, not from a client-provided completion flag, so
 * disjoint writes from concurrent tabs can still close the same night correctly.
 */
export const finalizeCudyrCompletion = (
  record: DailyRecord,
  options: { normalizeIntroducedLock?: boolean } = {}
): DailyRecord => {
  if (
    (record.cudyrLocked && !options.normalizeIntroducedLock) ||
    !resolveCudyrRecordCompletion(record).isComplete ||
    !hasValidCudyrSaveAttribution(record, {
      allowShiftDateNormalization: options.normalizeIntroducedLock,
    })
  ) {
    return record;
  }

  const completedAt = options.normalizeIntroducedLock
    ? record.cudyrUpdatedAt
    : record.cudyrCompletedAt || record.cudyrUpdatedAt;
  const completedBy = options.normalizeIntroducedLock
    ? record.cudyrUpdatedBy
    : record.cudyrCompletedBy || record.cudyrUpdatedBy;
  const lockedBy = options.normalizeIntroducedLock
    ? record.cudyrUpdatedById
    : record.cudyrLockedBy || record.cudyrUpdatedById;

  return {
    ...record,
    cudyrLocked: true,
    cudyrShiftDate: record.date,
    ...(completedAt
      ? {
          cudyrLockedAt: options.normalizeIntroducedLock
            ? completedAt
            : record.cudyrLockedAt || completedAt,
          cudyrCompletedAt: completedAt,
        }
      : {}),
    ...(completedBy ? { cudyrCompletedBy: completedBy } : {}),
    ...(lockedBy ? { cudyrLockedBy: lockedBy } : {}),
  };
};
