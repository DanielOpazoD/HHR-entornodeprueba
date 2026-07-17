import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { CudyrBatchUpdate, CudyrScore, CudyrScorePatch } from '@/types/domain/cudyr';
import { hasDisplayablePatientName } from '@/hooks/controllers/bedManagementPatientIdentityPatchController';
import {
  finalizeCudyrCompletion,
  resolveCudyrRecordCompletion,
} from '@/domain/cudyr/cudyrCompletion';
import { applyPatches } from '@/utils/patchUtils';

const getCudyrTimestampPatch = (savedAt = new Date().toISOString()) => ({
  cudyrUpdatedAt: savedAt,
});

const canApplyUnattributedLegacyCudyrPatch = (
  state: DailyRecord,
  patch: DailyRecordPatch
): boolean =>
  !state.cudyrLocked &&
  !resolveCudyrRecordCompletion(state).isComplete &&
  !resolveCudyrRecordCompletion(applyPatches(state, patch)).isComplete;

export const buildUpdateCudyrPatches = (
  state: DailyRecord,
  bedId: string,
  field: keyof CudyrScore,
  value: number
): DailyRecordPatch | null => {
  if (!hasDisplayablePatientName(state.beds[bedId])) {
    return null;
  }

  const patch = {
    [`beds.${bedId}.cudyr.${field}`]: value,
    ...getCudyrTimestampPatch(),
  } as DailyRecordPatch;
  return canApplyUnattributedLegacyCudyrPatch(state, patch) ? patch : null;
};

export const buildUpdateCudyrMultiplePatches = (
  state: DailyRecord,
  bedId: string,
  fields: CudyrScorePatch
): DailyRecordPatch | null => {
  if (!hasDisplayablePatientName(state.beds[bedId])) {
    return null;
  }

  const patches: Record<string, unknown> = {};
  Object.entries(fields).forEach(([field, value]) => {
    patches[`beds.${bedId}.cudyr.${field}`] = value;
  });

  if (Object.keys(patches).length === 0) {
    return null;
  }

  const patch = {
    ...patches,
    ...getCudyrTimestampPatch(),
  } as DailyRecordPatch;
  return canApplyUnattributedLegacyCudyrPatch(state, patch) ? patch : null;
};

export const buildUpdateCudyrBatchPatches = (
  state: DailyRecord,
  changes: CudyrBatchUpdate
): DailyRecordPatch | null => {
  const metadata = changes.metadata;
  if (
    !metadata ||
    metadata.shiftDate !== state.date ||
    !metadata.savedBy.trim() ||
    !metadata.savedById.trim() ||
    Number.isNaN(Date.parse(metadata.savedAt))
  ) {
    return null;
  }

  const isAlreadyComplete = state.cudyrLocked || resolveCudyrRecordCompletion(state).isComplete;
  if (isAlreadyComplete) {
    return null;
  }

  const patches: Record<string, unknown> = {};

  Object.entries(changes.beds ?? {}).forEach(([bedId, fields]) => {
    const patient = state.beds[bedId];
    if (!hasDisplayablePatientName(patient)) {
      return;
    }

    Object.entries(fields).forEach(([field, value]) => {
      patches[`beds.${bedId}.cudyr.${field}`] = value;
    });
  });

  Object.entries(changes.clinicalCribs ?? {}).forEach(([bedId, fields]) => {
    const crib = state.beds[bedId]?.clinicalCrib;
    if (!crib || !hasDisplayablePatientName(crib)) {
      return;
    }

    Object.entries(fields).forEach(([field, value]) => {
      patches[`beds.${bedId}.clinicalCrib.cudyr.${field}`] = value;
    });
  });

  if (Object.keys(patches).length === 0) {
    return null;
  }

  const basePatch = {
    ...patches,
    ...getCudyrTimestampPatch(metadata?.savedAt),
    ...(metadata?.savedBy ? { cudyrUpdatedBy: metadata.savedBy } : {}),
    ...(metadata?.savedById ? { cudyrUpdatedById: metadata.savedById } : {}),
    ...(metadata?.shiftDate ? { cudyrShiftDate: metadata.shiftDate } : {}),
  } as DailyRecordPatch;
  const prospective = finalizeCudyrCompletion(applyPatches(state, basePatch));

  if (!state.cudyrLocked && prospective.cudyrLocked) {
    Object.assign(basePatch, {
      cudyrLocked: true,
      cudyrLockedAt: prospective.cudyrLockedAt,
      cudyrLockedBy: prospective.cudyrLockedBy,
      cudyrShiftDate: prospective.cudyrShiftDate,
      cudyrCompletedAt: prospective.cudyrCompletedAt,
      cudyrCompletedBy: prospective.cudyrCompletedBy,
    });
  }

  return basePatch;
};

export const buildUpdateClinicalCribCudyrPatches = (
  state: DailyRecord,
  bedId: string,
  field: keyof CudyrScore,
  value: number
): DailyRecordPatch | null => {
  if (!hasDisplayablePatientName(state.beds[bedId].clinicalCrib)) {
    return null;
  }

  const patch = {
    [`beds.${bedId}.clinicalCrib.cudyr.${field}`]: value,
    ...getCudyrTimestampPatch(),
  } as DailyRecordPatch;
  return canApplyUnattributedLegacyCudyrPatch(state, patch) ? patch : null;
};

export const buildUpdateClinicalCribCudyrMultiplePatches = (
  state: DailyRecord,
  bedId: string,
  fields: CudyrScorePatch
): DailyRecordPatch | null => {
  if (!hasDisplayablePatientName(state.beds[bedId].clinicalCrib)) {
    return null;
  }

  const patches: Record<string, unknown> = {};
  Object.entries(fields).forEach(([field, value]) => {
    patches[`beds.${bedId}.clinicalCrib.cudyr.${field}`] = value;
  });

  if (Object.keys(patches).length === 0) {
    return null;
  }

  const patch = {
    ...patches,
    ...getCudyrTimestampPatch(),
  } as DailyRecordPatch;
  return canApplyUnattributedLegacyCudyrPatch(state, patch) ? patch : null;
};
