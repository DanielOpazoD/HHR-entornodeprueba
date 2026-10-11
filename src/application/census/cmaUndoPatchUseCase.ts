import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { CMAData } from '@/types/domain/movements';
import { tombstoneMovementsWhere } from '@/application/census/movementTombstonePolicy';
import { matchesRestoredPatientDestination } from '@/application/census/movementUndoIdentityPolicy';

export const buildUndoCmaPatch = (record: DailyRecord, item: CMAData): DailyRecordPatch | null => {
  if (!item.originalBedId || !item.originalData) {
    return null;
  }

  const bedId = item.originalBedId;
  const updatedBed = item.originalData;

  return {
    [`beds.${bedId}`]: updatedBed,
    discharges: tombstoneMovementsWhere(record.discharges, discharge =>
      matchesRestoredPatientDestination(discharge, bedId, updatedBed)
    ),
    transfers: tombstoneMovementsWhere(record.transfers, transfer =>
      matchesRestoredPatientDestination(transfer, bedId, updatedBed)
    ),
    cma: tombstoneMovementsWhere(
      record.cma,
      cma => cma.id === item.id || matchesRestoredPatientDestination(cma, bedId, updatedBed)
    ),
  } as DailyRecordPatch;
};
