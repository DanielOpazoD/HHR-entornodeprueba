import type { AuditLogEntry } from '@/types/auditLogTypes';

const UNKNOWN_PATIENT = 'Paciente no identificado';

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

interface ClinicalAuditNarrative {
  title: string;
  narrative: string;
  affectedSubject: string;
}

export const buildPatientDiagnosisAuditNarrative = (
  log: AuditLogEntry,
  details: Record<string, unknown>
): ClinicalAuditNarrative | null => {
  const patientName = asText(details.patientName) || UNKNOWN_PATIENT;

  if (log.action === 'PATIENT_DIAGNOSIS_CHANGED') {
    return {
      title: 'Diagnóstico actualizado',
      narrative: `Se actualizó el diagnóstico de ${patientName}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED') {
    const movementLabel = asText(details.movementLabel) || 'egreso';
    return {
      title: 'Diagnóstico de egreso actualizado',
      narrative: `Se actualizó el diagnóstico de egreso de ${patientName} en ${movementLabel}.`,
      affectedSubject: patientName,
    };
  }

  return null;
};
