export type PatientMovementKind = 'move' | 'copy' | 'undo_discharge';

interface BedMovementAuditDetailsInput {
  movementKind: Extract<PatientMovementKind, 'move' | 'copy'>;
  patientName: string;
  sourceBed: string;
  targetBed: string;
  previousLocation?: string;
  newLocation?: string;
}

interface DischargeUndoAuditDetailsInput {
  dischargeId: string;
  patientName: string;
  restoredBed: string;
}

export interface PatientMovementAuditDetails extends Record<string, unknown> {
  clinicalEvent: string;
  movementKind: PatientMovementKind;
  patientName?: string;
  sourceBed?: string;
  targetBed?: string;
  previousLocation?: string;
  newLocation?: string;
  dischargeId?: string;
  restoredBed?: string;
}

export const buildBedMovementAuditDetails = ({
  movementKind,
  patientName,
  sourceBed,
  targetBed,
  previousLocation,
  newLocation,
}: BedMovementAuditDetailsInput): PatientMovementAuditDetails => ({
  clinicalEvent:
    movementKind === 'move'
      ? 'Movimiento de paciente entre camas'
      : 'Copia de paciente a otra cama',
  movementKind,
  patientName,
  sourceBed,
  targetBed,
  previousLocation,
  newLocation,
});

export const buildDischargeUndoAuditDetails = ({
  dischargeId,
  patientName,
  restoredBed,
}: DischargeUndoAuditDetailsInput): PatientMovementAuditDetails => ({
  clinicalEvent: 'Reversión de alta',
  movementKind: 'undo_discharge',
  dischargeId,
  patientName,
  restoredBed,
});

export const buildPatientMovementSummary = (
  details: {
    movementKind?: unknown;
    patientName?: string;
    sourceBed?: string;
    targetBed?: string;
    restoredBed?: string;
  },
  fallbackEntityId: string = ''
): string | null => {
  const patientName = details.patientName || 'Paciente';

  if (details.movementKind === 'move') {
    return `Movimiento de cama: ${patientName} ${details.sourceBed || ''} → ${
      details.targetBed || fallbackEntityId
    }`;
  }

  if (details.movementKind === 'copy') {
    return `Copia de paciente: ${patientName} ${details.sourceBed || ''} → ${
      details.targetBed || fallbackEntityId
    }`;
  }

  if (details.movementKind === 'undo_discharge') {
    return `Reversión de alta: ${patientName} vuelve a cama ${
      details.restoredBed || fallbackEntityId
    }`;
  }

  return null;
};
