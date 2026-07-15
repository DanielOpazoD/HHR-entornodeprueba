import { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import type { PatientData } from '@/features/census/domain/movements/contracts/patient';
import type {
  DischargeAddCommandPayload,
  TransferCommandPayload,
} from '@/features/census/domain/movements/contracts';
import {
  ControllerError,
  ControllerResult,
  ok,
} from '@/features/census/controllers/controllerResult';
import { resolveMovementDisplayDate } from '@/features/census/controllers/censusMovementDatePresentationController';
import {
  resolveOccupiedMovementSource,
  resolveMovementBedDefinition,
  type MovementAuditEntry,
  type MovementCreationErrorCode,
} from '@/features/census/controllers/patientMovementCreationSharedController';
import {
  buildDischargeEntries,
  resolveDischargeUpdatedBed,
} from '@/features/census/controllers/patientMovementDischargeMutationController';
import {
  buildTransferEntries,
  resolveTransferUpdatedBed,
} from '@/features/census/controllers/patientMovementTransferMutationController';
import type { MovementProvenanceSeed } from '@/application/census/movementProvenancePolicy';

export type { MovementCreationErrorCode } from '@/features/census/controllers/patientMovementCreationSharedController';
export type MovementCreationError = ControllerError<MovementCreationErrorCode>;

export interface AddDischargeMovementInput {
  record: DailyRecord;
  bedId: string;
  payload: DischargeAddCommandPayload;
  bedsCatalog: readonly BedDefinition[];
  createEmptyPatient: (bedId: string) => PatientData;
  createId?: () => string;
  provenance?: MovementProvenanceSeed;
}

export interface AddTransferMovementInput {
  record: DailyRecord;
  bedId: string;
  payload: TransferCommandPayload;
  bedsCatalog: readonly BedDefinition[];
  createEmptyPatient: (bedId: string) => PatientData;
  createId?: () => string;
  provenance?: MovementProvenanceSeed;
}

type AddDischargeMovementResult = ControllerResult<
  { updatedRecord: DailyRecord; auditEntries: MovementAuditEntry[] },
  MovementCreationErrorCode,
  MovementCreationError
>;

type AddTransferMovementResult = ControllerResult<
  {
    updatedRecord: DailyRecord;
    auditEntry: { bedId: string; patientName: string; rut: string; receivingCenter: string };
  },
  MovementCreationErrorCode,
  MovementCreationError
>;

const defaultCreateId = (): string => crypto.randomUUID();

export const resolveAddDischargeMovement = ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
  createId = defaultCreateId,
  provenance,
}: AddDischargeMovementInput): AddDischargeMovementResult => {
  const sourceResolution = resolveOccupiedMovementSource({ record, bedId });
  if (!sourceResolution.ok) {
    return sourceResolution;
  }

  const { patient } = sourceResolution.value;
  const bedDef = resolveMovementBedDefinition(bedId, bedsCatalog);
  const resolvedMovementDate = resolveMovementDisplayDate(
    record.date,
    payload.movementDate,
    payload.time
  );
  const { discharges: newDischarges, auditEntries } = buildDischargeEntries({
    patient,
    bedId,
    bedDef,
    payload,
    resolvedMovementDate,
    createId,
    provenance,
  });
  const updatedBeds = {
    ...record.beds,
    [bedId]: resolveDischargeUpdatedBed({
      patient,
      bedId,
      target: payload.dischargeTarget,
      createEmptyPatient,
    }),
  };

  return ok({
    updatedRecord: {
      ...record,
      beds: updatedBeds,
      discharges: [...(record.discharges || []), ...newDischarges],
    },
    auditEntries,
  });
};

export const resolveAddTransferMovement = ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
  createId = defaultCreateId,
  provenance,
}: AddTransferMovementInput): AddTransferMovementResult => {
  const sourceResolution = resolveOccupiedMovementSource({ record, bedId });
  if (!sourceResolution.ok) {
    return sourceResolution;
  }

  const { patient } = sourceResolution.value;
  const bedDef = resolveMovementBedDefinition(bedId, bedsCatalog);
  const resolvedMovementDate = resolveMovementDisplayDate(
    record.date,
    payload.movementDate,
    payload.time
  );
  const newTransfers = buildTransferEntries({
    patient,
    bedId,
    bedDef,
    payload,
    resolvedMovementDate,
    createId,
    provenance,
  });
  const updatedBeds = {
    ...record.beds,
    [bedId]: resolveTransferUpdatedBed({
      bedId,
      patient,
      createEmptyPatient,
    }),
  };

  return ok({
    updatedRecord: {
      ...record,
      beds: updatedBeds,
      transfers: [...(record.transfers || []), ...newTransfers],
    },
    auditEntry: {
      bedId,
      patientName: patient.patientName,
      rut: patient.rut,
      receivingCenter: payload.receivingCenter,
    },
  });
};
