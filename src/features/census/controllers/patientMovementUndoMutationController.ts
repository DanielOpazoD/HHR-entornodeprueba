import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import type { PatientData } from '@/features/census/domain/movements/contracts/patient';
import type {
  CMAData,
  DischargeData,
  TransferData,
} from '@/features/census/contracts/censusMovementContracts';
import { tombstoneMovementsWhere } from '@/application/census/movementTombstonePolicy';

interface ApplyUndoDischargeInput {
  record: DailyRecord;
  dischargeId: string;
  bedId: string;
  updatedBed: PatientData;
}

interface ApplyUndoTransferInput {
  record: DailyRecord;
  transferId: string;
  bedId: string;
  updatedBed: PatientData;
}

interface ApplyUndoCmaInput {
  record: DailyRecord;
  cmaId: string;
  bedId: string;
  updatedBed: PatientData;
}

interface RestoredPatientDestinationInput {
  record: DailyRecord;
  bedId: string;
  updatedBed: PatientData;
  dischargeId?: string;
  transferId?: string;
  cmaId?: string;
}

const normalizeIdentityValue = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? '';

const matchesRestoredPatient = (
  movement: Pick<
    DischargeData | TransferData | CMAData,
    'patientName' | 'rut' | 'clinicalEpisodeId'
  >,
  updatedBed: PatientData
): boolean => {
  const movementEpisodeId = normalizeIdentityValue(movement.clinicalEpisodeId);
  const restoredEpisodeId = normalizeIdentityValue(updatedBed.clinicalEpisodeId);
  if (movementEpisodeId && restoredEpisodeId) {
    return movementEpisodeId === restoredEpisodeId;
  }

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
    | Pick<DischargeData | TransferData, 'bedId' | 'patientName' | 'rut' | 'clinicalEpisodeId'>
    | Pick<CMAData, 'originalBedId' | 'patientName' | 'rut' | 'clinicalEpisodeId'>,
  bedId: string,
  updatedBed: PatientData
): boolean =>
  matchesRestoredSourceBed(movement, bedId) && matchesRestoredPatient(movement, updatedBed);

export const removeRestoredPatientDestinationEntries = ({
  record,
  bedId,
  updatedBed,
  dischargeId,
  transferId,
  cmaId,
}: RestoredPatientDestinationInput): DailyRecord => ({
  ...record,
  discharges: tombstoneMovementsWhere(
    record.discharges,
    discharge =>
      discharge.id === dischargeId ||
      shouldRemoveRestoredPatientDestination(discharge, bedId, updatedBed)
  ),
  transfers: tombstoneMovementsWhere(
    record.transfers,
    transfer =>
      transfer.id === transferId ||
      shouldRemoveRestoredPatientDestination(transfer, bedId, updatedBed)
  ),
  cma: tombstoneMovementsWhere(
    record.cma,
    item => item.id === cmaId || shouldRemoveRestoredPatientDestination(item, bedId, updatedBed)
  ),
});

export const resolveApplyUndoDischargeRecord = ({
  record,
  dischargeId,
  bedId,
  updatedBed,
}: ApplyUndoDischargeInput): DailyRecord =>
  removeRestoredPatientDestinationEntries({
    record: {
      ...record,
      beds: {
        ...record.beds,
        [bedId]: updatedBed,
      },
    },
    bedId,
    updatedBed,
    dischargeId,
  });

export const resolveApplyUndoTransferRecord = ({
  record,
  transferId,
  bedId,
  updatedBed,
}: ApplyUndoTransferInput): DailyRecord =>
  removeRestoredPatientDestinationEntries({
    record: {
      ...record,
      beds: {
        ...record.beds,
        [bedId]: updatedBed,
      },
    },
    bedId,
    updatedBed,
    transferId,
  });

export const resolveApplyUndoCmaRecord = ({
  record,
  cmaId,
  bedId,
  updatedBed,
}: ApplyUndoCmaInput): DailyRecord =>
  removeRestoredPatientDestinationEntries({
    record: {
      ...record,
      beds: {
        ...record.beds,
        [bedId]: updatedBed,
      },
    },
    bedId,
    updatedBed,
    cmaId,
  });
