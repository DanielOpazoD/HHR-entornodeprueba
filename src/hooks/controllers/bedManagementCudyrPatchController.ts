import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { CudyrBatchUpdate, CudyrScore, CudyrScorePatch } from '@/types/domain/cudyr';
import { hasDisplayablePatientName } from '@/hooks/controllers/bedManagementPatientIdentityPatchController';

const getCudyrTimestampPatch = () => ({
  cudyrUpdatedAt: new Date().toISOString(),
});

export const buildUpdateCudyrPatches = (
  state: DailyRecord,
  bedId: string,
  field: keyof CudyrScore,
  value: number
): DailyRecordPatch | null => {
  if (!hasDisplayablePatientName(state.beds[bedId])) {
    return null;
  }

  return {
    [`beds.${bedId}.cudyr.${field}`]: value,
    ...getCudyrTimestampPatch(),
  } as DailyRecordPatch;
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

  return {
    ...patches,
    ...getCudyrTimestampPatch(),
  } as DailyRecordPatch;
};

export const buildUpdateCudyrBatchPatches = (
  state: DailyRecord,
  changes: CudyrBatchUpdate
): DailyRecordPatch | null => {
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

  return {
    ...patches,
    ...getCudyrTimestampPatch(),
  } as DailyRecordPatch;
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

  return {
    [`beds.${bedId}.clinicalCrib.cudyr.${field}`]: value,
    ...getCudyrTimestampPatch(),
  } as DailyRecordPatch;
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

  return {
    ...patches,
    ...getCudyrTimestampPatch(),
  } as DailyRecordPatch;
};
