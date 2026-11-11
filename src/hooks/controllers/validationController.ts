import type { PatientData } from '@/types/domain/patient';

import type { DailyRecordBedsState } from '@/types/domain/dailyRecordSlices';

export interface MovePatientValidationResult {
  canMove: boolean;
  reason?: string;
}

export const validateMovePatient = (
  targetBedId: string,
  record: DailyRecordBedsState | null
): MovePatientValidationResult => {
  if (!record) {
    return { canMove: false, reason: 'No hay registro cargado' };
  }

  const targetBed = record.beds[targetBedId];
  if (targetBed?.patientName?.trim()) {
    return { canMove: false, reason: 'La cama de destino ya está ocupada' };
  }

  if (targetBed?.isBlocked) {
    return { canMove: false, reason: 'La cama de destino está bloqueada' };
  }

  return { canMove: true };
};

export const validatePatientDischarge = (
  patient: Pick<PatientData, 'patientName' | 'admissionDate'>
): boolean => Boolean(patient.patientName?.trim() && patient.admissionDate);
