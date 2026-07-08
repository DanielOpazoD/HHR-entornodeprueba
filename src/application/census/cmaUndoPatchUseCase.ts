import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';
import { tombstoneMovementsWhere } from '@/application/census/movementTombstonePolicy';

type RestoredPatient = NonNullable<DailyRecord['beds']>[string];

const normalizeIdentityValue = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? '';

const matchesRestoredPatient = (
  movement: Pick<DischargeData | TransferData | CMAData, 'patientName' | 'rut'>,
  updatedBed: RestoredPatient
): boolean => {
  const movementRut = normalizeIdentityValue(movement.rut);
  const restoredRut = normalizeIdentityValue(updatedBed.rut);
  if (movementRut && restoredRut) {
    return movementRut === restoredRut;
  }

  const movementName = normalizeIdentityValue(movement.patientName);
  const restoredName = normalizeIdentityValue(updatedBed.patientName);
  return Boolean(movementName && restoredName && movementName === restoredName);
};

const matchesRestoredSourceBed = (
  movement: Pick<DischargeData | TransferData, 'bedId'> | Pick<CMAData, 'originalBedId'>,
  bedId: string
): boolean => {
  if ('originalBedId' in movement) {
    return movement.originalBedId === bedId;
  }

  return (movement as Pick<DischargeData | TransferData, 'bedId'>).bedId === bedId;
};

const shouldRemoveRestoredPatientDestination = (
  movement:
    | Pick<DischargeData | TransferData, 'bedId' | 'patientName' | 'rut'>
    | Pick<CMAData, 'originalBedId' | 'patientName' | 'rut'>,
  bedId: string,
  updatedBed: RestoredPatient
): boolean =>
  matchesRestoredSourceBed(movement, bedId) && matchesRestoredPatient(movement, updatedBed);

export const buildUndoCmaPatch = (record: DailyRecord, item: CMAData): DailyRecordPatch | null => {
  if (!item.originalBedId || !item.originalData) {
    return null;
  }

  const bedId = item.originalBedId;
  const updatedBed = item.originalData;

  return {
    [`beds.${bedId}`]: updatedBed,
    discharges: tombstoneMovementsWhere(record.discharges, discharge =>
      shouldRemoveRestoredPatientDestination(discharge, bedId, updatedBed)
    ),
    transfers: tombstoneMovementsWhere(record.transfers, transfer =>
      shouldRemoveRestoredPatientDestination(transfer, bedId, updatedBed)
    ),
    cma: tombstoneMovementsWhere(
      record.cma,
      cma => cma.id === item.id || shouldRemoveRestoredPatientDestination(cma, bedId, updatedBed)
    ),
  } as DailyRecordPatch;
};
