import { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import type { PatientData } from '@/features/census/domain/movements/contracts/patient';
import { ControllerResult, failWithCode, ok } from '@/features/census/controllers/controllerResult';
import { deepClone } from '@/utils/deepClone';
import { buildMovementUndoSnapshot } from '@/utils/movementUndoSnapshot';

export type MovementCreationErrorCode = 'BED_NOT_FOUND' | 'SOURCE_BED_EMPTY';

export interface MovementAuditEntry {
  movementId?: string;
  bedId: string;
  patientName: string;
  rut: string;
  status: 'Vivo' | 'Fallecido';
  diagnosis?: string;
  movementDate?: string;
  time?: string;
  dischargeType?: string;
  dischargeTypeOther?: string;
  clinicalEpisodeId?: string;
}

/** Snapshot para deshacer un movimiento — sin el caché de sincronización (ver util). */
export const clonePatientSnapshot = (patient: PatientData): PatientData =>
  buildMovementUndoSnapshot(deepClone(patient));

export const resolveMovementBedDefinition = (
  bedId: string,
  bedsCatalog: readonly BedDefinition[]
): BedDefinition | undefined => bedsCatalog.find(bed => bed.id === bedId);

export const buildClearedBedPatient = ({
  bedId,
  location,
  createEmptyPatient,
}: {
  bedId: string;
  location?: string;
  createEmptyPatient: (bedId: string) => PatientData;
}): PatientData => {
  const cleanPatient = createEmptyPatient(bedId);
  cleanPatient.location = location;
  return cleanPatient;
};

export const resolveOccupiedMovementSource = ({
  record,
  bedId,
}: {
  record: DailyRecord;
  bedId: string;
}): ControllerResult<{ patient: PatientData }, MovementCreationErrorCode> => {
  const patient = record.beds[bedId];
  if (!patient) {
    return failWithCode('BED_NOT_FOUND', `No existe la cama ${bedId} en el registro actual.`);
  }
  if (!patient.patientName) {
    return failWithCode('SOURCE_BED_EMPTY', `No se puede operar una cama vacia: ${bedId}.`);
  }
  return ok({ patient });
};
