import type { PatientData } from '@/types/domain/patient';

import { BedDefinition } from '@/types/domain/beds';
import type { DailyRecord } from '@/types/domain/dailyRecord';

import { ControllerResult, failWithCode, ok } from '@/shared/contracts/controllerResult';

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
