import { PatientData } from '@/types';
import {
  ControllerError,
  ControllerResult,
  failWithCode,
  ok,
} from '@/features/census/controllers/controllerResult';

export type UndoPatientMovementErrorCode =
  | 'BED_NOT_FOUND'
  | 'ORIGINAL_DATA_MISSING'
  | 'ORIGINAL_DATA_INVALID'
  | 'MAIN_BED_OCCUPIED'
  | 'MAIN_BED_EMPTY'
  | 'CLINICAL_CRIB_OCCUPIED';

export type UndoPatientMovementError = ControllerError<UndoPatientMovementErrorCode>;
export type UndoPatientMovementResult = ControllerResult<
  { updatedBed: PatientData },
  UndoPatientMovementErrorCode,
  UndoPatientMovementError
>;

interface UndoPatientMovementInput {
  bedData: PatientData | undefined;
  bedId: string;
  isNested?: boolean;
  originalData?: PatientData;
  createEmptyPatient: (bedId: string) => PatientData;
}

const isPatientSnapshot = (value: unknown): value is PatientData =>
  typeof value === 'object' && value !== null;

export const resolveUndoPatientMovement = ({
  bedData,
  bedId,
  isNested,
  originalData,
  createEmptyPatient,
}: UndoPatientMovementInput): UndoPatientMovementResult => {
  if (!bedData) {
    return failWithCode('BED_NOT_FOUND', 'No se encontró la cama asociada al movimiento.');
  }

  if (!originalData) {
    return failWithCode('ORIGINAL_DATA_MISSING', 'No existe snapshot original para restaurar.');
  }

  if (!isPatientSnapshot(originalData)) {
    return failWithCode('ORIGINAL_DATA_INVALID', 'El snapshot original del paciente es inválido.');
  }

  if (!isNested) {
    if (bedData.patientName) {
      return failWithCode('MAIN_BED_OCCUPIED', 'La cama principal está ocupada.');
    }

    const empty = createEmptyPatient(bedId);
    return ok({
      updatedBed: {
        ...empty,
        ...originalData,
        location: bedData.location,
      },
    });
  }

  if (!bedData.patientName) {
    return failWithCode(
      'MAIN_BED_EMPTY',
      'La cama principal debe estar ocupada para restaurar una cuna clínica.'
    );
  }

  if (bedData.clinicalCrib?.patientName) {
    return failWithCode('CLINICAL_CRIB_OCCUPIED', 'Ya existe una cuna clínica ocupada en la cama.');
  }

  return ok({
    updatedBed: {
      ...bedData,
      clinicalCrib: originalData,
    },
  });
};
