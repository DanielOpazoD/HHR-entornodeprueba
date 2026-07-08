import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';

export type AtomicPatientMovementListKey = 'discharges' | 'transfers' | 'cma';
export type AtomicPatientMovementKind = 'discharge' | 'transfer';

interface BuildAtomicPatientMovementPatchInput {
  updatedRecord: DailyRecord;
  movementKey: AtomicPatientMovementListKey;
  sourceBedIds: string[];
}

const movementListKeyByKind: Record<AtomicPatientMovementKind, AtomicPatientMovementListKey> = {
  discharge: 'discharges',
  transfer: 'transfers',
};

export const resolveAtomicPatientMovementListKey = (
  kind: AtomicPatientMovementKind
): AtomicPatientMovementListKey => movementListKeyByKind[kind];

export const buildAtomicPatientMovementPatch = ({
  updatedRecord,
  movementKey,
  sourceBedIds,
}: BuildAtomicPatientMovementPatchInput): DailyRecordPatch => {
  const patch = {
    [movementKey]: updatedRecord[movementKey] ?? [],
  } as DailyRecordPatch;

  Array.from(new Set(sourceBedIds)).forEach(bedId => {
    const updatedBed = updatedRecord.beds?.[bedId];
    if (!updatedBed) return;

    patch[`beds.${bedId}`] = updatedBed;
  });

  return patch;
};
