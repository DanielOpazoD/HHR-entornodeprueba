export type PatientMovementKind = 'move' | 'copy' | 'undo_discharge';

interface DischargeDiagnosisChangeAuditDetailsInput {
  patientName: string;
  movementId: string;
  movementLabel: string;
  previousDiagnosis?: string;
  nextDiagnosis?: string;
  clinicalEpisodeId?: string;
}

interface DischargeReclassificationAuditDetailsInput {
  patientName: string;
  movementId: string;
  previousMovementId: string;
  from: string;
  to: string;
  lineageId: string;
  clinicalEpisodeId?: string;
}

interface BedMovementAuditDetailsInput {
  movementKind: Extract<PatientMovementKind, 'move' | 'copy'>;
  patientName: string;
  sourceBed: string;
  targetBed: string;
  diagnosis?: string;
  previousLocation?: string;
  newLocation?: string;
}

interface DischargeUndoAuditDetailsInput {
  dischargeId: string;
  patientName: string;
  restoredBed: string;
}

interface PatientDischargedAuditDetailsInput {
  patientName: string;
  status: 'Vivo' | 'Fallecido';
  bedId: string;
  rut: string;
  episodeKey?: string;
  movementDate?: string;
  time?: string;
  diagnosis?: string;
  dischargeType?: string;
  dischargeTypeOther?: string;
  dischargeTarget?: string;
}

export interface PatientMovementAuditDetails extends Record<string, unknown> {
  clinicalEvent: string;
  movementKind: PatientMovementKind;
  patientName?: string;
  sourceBed?: string;
  targetBed?: string;
  previousLocation?: string;
  newLocation?: string;
  diagnosis?: string;
  dischargeId?: string;
  restoredBed?: string;
}

export interface DischargeDiagnosisChangeAuditDetails extends Record<string, unknown> {
  clinicalEvent: string;
  patientName: string;
  movementId: string;
  movementLabel: string;
  clinicalEpisodeId?: string;
  changes: {
    diagnosis: {
      old: string;
      new: string;
    };
  };
}

export interface DischargeReclassificationAuditDetails extends Record<string, unknown> {
  clinicalEvent: string;
  patientName: string;
  movementId: string;
  previousMovementId: string;
  from: string;
  to: string;
  lineageId: string;
  clinicalEpisodeId?: string;
}

export interface PatientDischargedAuditDetails extends Record<string, unknown> {
  clinicalEvent: string;
  patientName: string;
  status: 'Vivo' | 'Fallecido';
  bedId: string;
  rut: string;
  episodeKey?: string;
  movementDate?: string;
  time?: string;
  diagnosis?: string;
  dischargeType?: string;
  dischargeTypeOther?: string;
  dischargeTarget?: string;
}

export const buildBedMovementAuditDetails = ({
  movementKind,
  patientName,
  sourceBed,
  targetBed,
  diagnosis,
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
  diagnosis,
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

export const buildPatientDischargedAuditDetails = ({
  patientName,
  status,
  bedId,
  rut,
  episodeKey,
  movementDate,
  time,
  diagnosis,
  dischargeType,
  dischargeTypeOther,
  dischargeTarget,
}: PatientDischargedAuditDetailsInput): PatientDischargedAuditDetails => {
  const details = {
    clinicalEvent: 'Alta de paciente',
    patientName,
    status,
    bedId,
    rut,
    episodeKey,
    movementDate,
    time,
    diagnosis,
    dischargeType,
    dischargeTypeOther,
    dischargeTarget,
  };

  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined)
  ) as PatientDischargedAuditDetails;
};

export const buildDischargeDiagnosisChangeAuditDetails = ({
  patientName,
  movementId,
  movementLabel,
  previousDiagnosis,
  nextDiagnosis,
  clinicalEpisodeId,
}: DischargeDiagnosisChangeAuditDetailsInput): DischargeDiagnosisChangeAuditDetails => ({
  clinicalEvent: 'Actualización de diagnóstico de egreso',
  patientName,
  movementId,
  movementLabel,
  clinicalEpisodeId,
  changes: {
    diagnosis: {
      old: previousDiagnosis || '',
      new: nextDiagnosis || '',
    },
  },
});

export const buildDischargeReclassificationAuditDetails = ({
  patientName,
  movementId,
  previousMovementId,
  from,
  to,
  lineageId,
  clinicalEpisodeId,
}: DischargeReclassificationAuditDetailsInput): DischargeReclassificationAuditDetails => ({
  clinicalEvent: 'Reclasificación de egreso',
  patientName,
  movementId,
  previousMovementId,
  from,
  to,
  lineageId,
  clinicalEpisodeId,
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
