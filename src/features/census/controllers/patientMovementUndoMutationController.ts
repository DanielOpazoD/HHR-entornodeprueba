import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import type { PatientData } from '@/features/census/domain/movements/contracts/patient';
import { tombstoneMovementsWhere } from '@/application/census/movementTombstonePolicy';
import { matchesRestoredPatientDestination } from '@/application/census/movementUndoIdentityPolicy';

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
      matchesRestoredPatientDestination(discharge, bedId, updatedBed)
  ),
  transfers: tombstoneMovementsWhere(
    record.transfers,
    transfer =>
      transfer.id === transferId || matchesRestoredPatientDestination(transfer, bedId, updatedBed)
  ),
  cma: tombstoneMovementsWhere(
    record.cma,
    item => item.id === cmaId || matchesRestoredPatientDestination(item, bedId, updatedBed)
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
