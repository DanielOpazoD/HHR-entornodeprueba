import { UndoPatientMovementErrorCode } from '@/features/census/controllers/patientMovementUndoController';

export type UndoMovementKind = 'discharge' | 'transfer';

interface UndoMovementDescriptor {
  patientName: string;
  bedName: string;
}

const dischargeErrorMessageByCode = (
  code: UndoPatientMovementErrorCode,
  descriptor: UndoMovementDescriptor
): string => {
  switch (code) {
    case 'MAIN_BED_OCCUPIED':
      return `No se puede deshacer el alta de ${descriptor.patientName} porque la cama ${descriptor.bedName} ya está ocupada por otro paciente.`;
    case 'MAIN_BED_EMPTY':
      return 'Para restaurar la cuna clínica, primero debe estar ocupada la cama principal(Madre / Tutor).';
    case 'CLINICAL_CRIB_OCCUPIED':
      return `No se puede deshacer el alta de ${descriptor.patientName} porque ya existe una cuna clínica ocupada en esta cama.`;
    case 'BED_NOT_FOUND':
      return 'No se pudo restaurar el alta porque la cama asociada ya no existe en el registro.';
    case 'ORIGINAL_DATA_MISSING':
    case 'ORIGINAL_DATA_INVALID':
      return 'No se pudo restaurar el alta porque faltan datos originales del paciente.';
    default:
      return 'No se pudo deshacer el alta.';
  }
};

const transferErrorMessageByCode = (
  code: UndoPatientMovementErrorCode,
  descriptor: UndoMovementDescriptor
): string => {
  switch (code) {
    case 'MAIN_BED_OCCUPIED':
      return `No se puede deshacer el traslado de ${descriptor.patientName} porque la cama ${descriptor.bedName} ya está ocupada.`;
    case 'MAIN_BED_EMPTY':
      return 'Para restaurar la cuna clínica, primero debe estar ocupada la cama principal.';
    case 'CLINICAL_CRIB_OCCUPIED':
      return `No se puede deshacer el traslado de ${descriptor.patientName} porque ya existe una cuna clínica ocupada.`;
    case 'BED_NOT_FOUND':
      return 'No se pudo restaurar el traslado porque la cama asociada ya no existe en el registro.';
    case 'ORIGINAL_DATA_MISSING':
    case 'ORIGINAL_DATA_INVALID':
      return 'No se pudo restaurar el traslado porque faltan datos originales del paciente.';
    default:
      return 'No se pudo deshacer el traslado.';
  }
};

export const getUndoMovementErrorMessage = (
  kind: UndoMovementKind,
  code: UndoPatientMovementErrorCode,
  descriptor: UndoMovementDescriptor
): string =>
  kind === 'discharge'
    ? dischargeErrorMessageByCode(code, descriptor)
    : transferErrorMessageByCode(code, descriptor);
