import { BEDS } from '@/constants/beds';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import { BedType } from '@/types/domain/beds';
import { getBedTypeForRecord } from '@/utils/bedTypeUtils';
import { deepClone } from '@/utils/deepClone';
import { normalizePatientUpcForBed } from '@/shared/census/upcBedPolicy';

export const buildClearedPatient = (record: DailyRecord, bedId: string): PatientData => {
  // Reuse the same empty-bed contract after discharge, transfer, or manual clear.
  const cleanPatient = createEmptyPatient(bedId);
  cleanPatient.location = record.beds[bedId]?.location;
  cleanPatient.clinicalCrib = undefined;
  cleanPatient.hasCompanionCrib = false;
  return cleanPatient;
};

export const buildClearAllBedsPatch = (record: DailyRecord): DailyRecordPatch => {
  const updatedBeds: Record<string, PatientData> = {};

  BEDS.forEach(bed => {
    updatedBeds[bed.id] = buildClearedPatient(record, bed.id);
  });

  return {
    beds: updatedBeds,
    discharges: [],
    transfers: [],
  };
};

export const buildMoveOrCopyPatch = (
  record: DailyRecord,
  type: 'move' | 'copy',
  sourceBedId: string,
  targetBedId: string
): DailyRecordPatch | null => {
  const sourceData = record.beds[sourceBedId];
  if (!sourceData?.patientName) {
    return null;
  }

  const patch: DailyRecordPatch = {};
  patch[`beds.${targetBedId}`] = normalizePatientUpcForBed(
    {
      ...deepClone(sourceData),
      location: record.beds[targetBedId].location,
    },
    targetBedId
  );

  if (type === 'move') {
    patch[`beds.${sourceBedId}`] = buildClearedPatient(record, sourceBedId);
  }

  return patch;
};

export const buildClearPatientPatch = (
  record: DailyRecord,
  bedId: string
): { patch: DailyRecordPatch; clearedPatient: PatientData } => {
  const clearedPatient = buildClearedPatient(record, bedId);

  return {
    clearedPatient,
    patch: {
      [`beds.${bedId}`]: clearedPatient,
    } as DailyRecordPatch,
  };
};

export const buildToggleBlockedPatch = (
  record: DailyRecord,
  bedId: string,
  reason?: string
): { patch: DailyRecordPatch; newIsBlocked: boolean } => {
  const currentBed = record.beds[bedId];
  const newIsBlocked = !currentBed.isBlocked;

  return {
    newIsBlocked,
    patch: {
      [`beds.${bedId}.isBlocked`]: newIsBlocked,
      [`beds.${bedId}.blockedReason`]: newIsBlocked ? reason || '' : '',
    } as DailyRecordPatch,
  };
};

export const buildBlockedReasonPatch = (bedId: string, reason: string): DailyRecordPatch =>
  ({
    [`beds.${bedId}.blockedReason`]: reason || '',
  }) as DailyRecordPatch;

export const buildActiveExtraBeds = (currentExtras: string[], bedId: string): string[] =>
  currentExtras.includes(bedId)
    ? currentExtras.filter(id => id !== bedId)
    : [...currentExtras, bedId];

export const buildToggleBedTypePatch = (
  record: DailyRecord,
  bedId: string
): { patch: DailyRecordPatch; currentType: BedType; nextType: BedType } | null => {
  const bedDef = BEDS.find(b => b.id === bedId);
  if (!bedDef) return null;

  const currentType = getBedTypeForRecord(bedDef, record);
  const nextType = currentType === BedType.UTI ? BedType.UCI : BedType.UTI;
  const updatedOverrides = { ...(record.bedTypeOverrides || {}) };

  if (nextType === bedDef.type) {
    delete updatedOverrides[bedId];
  } else {
    updatedOverrides[bedId] = nextType;
  }

  return {
    currentType,
    nextType,
    patch: {
      bedTypeOverrides: updatedOverrides,
    },
  };
};
