import type { AuditLogEntry } from '@/types/auditLogTypes';
import { buildConflictAutoMergedAuditNarrative } from '@/services/admin/clinicalAuditConflictNarratives';
import { buildClinicalDocumentAuditNarrative } from '@/services/admin/clinicalAuditDocumentNarratives';
import { buildMedicalIndicationAuditNarrative } from '@/services/admin/medicalIndicationAuditNarratives';
import { buildPatientDiagnosisAuditNarrative } from '@/services/admin/clinicalAuditPatientNarratives';

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const getPatientName = (details: Record<string, unknown>): string =>
  asText(details.patientName) || 'Paciente no identificado';

const getActorLabel = (log: AuditLogEntry): string =>
  asText(log.userDisplayName) ||
  asText(log.userId) ||
  asText(log.userUid) ||
  'Usuario no identificado';

const getBedLabel = (value: unknown): string => {
  const text = asText(value);
  return text ? `cama ${text}` : 'cama no especificada';
};

const getEntityLabel = (log: AuditLogEntry, details: Record<string, unknown>): string =>
  asText(details.patientName) || asText(details.bedId) || asText(log.entityId) || log.entityType;

const getRecordLabel = (log: AuditLogEntry): string => asText(log.entityId) || 'registro';

interface ClinicalAuditNarrative {
  title: string;
  narrative: string;
  affectedSubject: string;
}

export const buildKnownClinicalAuditNarrative = (
  log: AuditLogEntry,
  details: Record<string, unknown>
): ClinicalAuditNarrative => {
  const patientName = getPatientName(details);
  const entityId = asText(log.entityId);
  const bedId = asText(details.bedId) || entityId;

  if (
    (log.action === 'PATIENT_MODIFIED' || log.action === 'PATIENT_BED_CHANGED') &&
    details.movementKind === 'move'
  ) {
    return {
      title: 'Paciente trasladado de cama',
      narrative: `${patientName} fue trasladado desde ${getBedLabel(details.sourceBed)} a ${getBedLabel(details.targetBed)}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'PATIENT_MODIFIED' && details.movementKind === 'copy') {
    return {
      title: 'Paciente copiado a otra cama',
      narrative: `${patientName} fue copiado desde ${getBedLabel(details.sourceBed)} a ${getBedLabel(details.targetBed)}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'PATIENT_MODIFIED' && details.movementKind === 'undo_discharge') {
    return {
      title: 'Alta revertida',
      narrative: `${patientName} fue reincorporado al censo en ${getBedLabel(details.restoredBed || entityId)}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'PATIENT_ADMITTED') {
    return {
      title: 'Paciente ingresado',
      narrative: `${patientName} fue ingresado en ${getBedLabel(bedId)}.`,
      affectedSubject: patientName,
    };
  }

  const patientDiagnosisNarrative = buildPatientDiagnosisAuditNarrative(log, details);
  if (patientDiagnosisNarrative) return patientDiagnosisNarrative;

  if (log.action === 'PATIENT_DISCHARGED') {
    return {
      title: 'Paciente dado de alta',
      narrative: `${patientName} fue registrado como egresado.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'PATIENT_TRANSFERRED') {
    const destination = asText(details.destination) || 'destino no especificado';
    return {
      title: 'Paciente derivado o trasladado',
      narrative: `${patientName} fue trasladado hacia ${destination}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'PATIENT_CLEARED') {
    const bedLabel = getBedLabel(asText(details.bedId) || entityId);
    return {
      title: 'Cama liberada',
      narrative: `Se liberó ${bedLabel} en el censo clínico.`,
      affectedSubject: asText(details.patientName) || bedLabel,
    };
  }

  if (log.action === 'PATIENT_NOTE_UPDATED') {
    return {
      title: 'Nota clínica del paciente actualizada',
      narrative: `Se actualizó una nota clínica asociada a ${patientName}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'CLINICAL_EVENT_ADDED') {
    return {
      title: 'Evento clínico agregado',
      narrative: `Se agregó un evento clínico asociado a ${patientName}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'CLINICAL_EVENT_UPDATED') {
    return {
      title: 'Evento clínico actualizado',
      narrative: `Se actualizó un evento clínico asociado a ${patientName}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'CLINICAL_EVENT_DELETED') {
    return {
      title: 'Evento clínico eliminado',
      narrative: `Se eliminó un evento clínico asociado a ${patientName}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'DAILY_RECORD_CREATED') {
    return {
      title: 'Registro diario creado',
      narrative: `Se creó el registro clínico diario ${getRecordLabel(log)}.`,
      affectedSubject: getRecordLabel(log),
    };
  }

  if (log.action === 'DAILY_RECORD_DELETED') {
    return {
      title: 'Registro diario eliminado',
      narrative: `Se eliminó el registro clínico diario ${getRecordLabel(log)}.`,
      affectedSubject: getRecordLabel(log),
    };
  }

  if (log.action === 'NURSE_HANDOFF_MODIFIED') {
    return {
      title: 'Entrega de enfermería actualizada',
      narrative: `Se actualizó la entrega de enfermería del registro ${getRecordLabel(log)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'MEDICAL_HANDOFF_MODIFIED') {
    return {
      title: 'Entrega médica actualizada',
      narrative: `Se actualizó la entrega médica del registro ${getRecordLabel(log)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'HANDOFF_NOVEDADES_MODIFIED') {
    return {
      title: 'Novedades de entrega actualizadas',
      narrative: `Se actualizaron las novedades de entrega del registro ${getRecordLabel(log)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'MEDICAL_HANDOFF_SIGNED') {
    return {
      title: 'Entrega médica firmada',
      narrative: `Se firmó la entrega médica del registro ${getRecordLabel(log)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'MEDICAL_HANDOFF_RESTORED') {
    return {
      title: 'Entrega médica restaurada',
      narrative: `Se restauró una entrega médica previamente guardada para ${getRecordLabel(log)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'CUDYR_MODIFIED') {
    return {
      title: 'Evaluación CUDYR actualizada',
      narrative: `Se actualizó la evaluación CUDYR asociada a ${patientName}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'CUDYR_BATCH_SAVED') {
    return {
      title: 'Guardado CUDYR confirmado',
      narrative: `Se guardó la evaluación CUDYR del registro ${getRecordLabel(log)} con ${details.fieldCount || 0} cambios en ${details.patientCount || 0} paciente(s).`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'VIEW_CUDYR') {
    return {
      title: 'Evaluación CUDYR visualizada',
      narrative: `Se visualizó la evaluación CUDYR asociada a ${getEntityLabel(log, details)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'VIEW_NURSING_HANDOFF') {
    return {
      title: 'Entrega de enfermería visualizada',
      narrative: `Se visualizó la entrega de enfermería del registro ${getRecordLabel(log)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'VIEW_MEDICAL_HANDOFF') {
    return {
      title: 'Entrega médica visualizada',
      narrative: `Se visualizó la entrega médica del registro ${getRecordLabel(log)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'PATIENT_VIEWED' || log.action === 'VIEW_PATIENT') {
    return {
      title: 'Ficha clínica visualizada',
      narrative: `Se visualizó la ficha clínica de ${patientName}.`,
      affectedSubject: patientName,
    };
  }

  if (log.action === 'BED_BLOCKED') {
    const reason = asText(details.reason);
    return {
      title: 'Cama bloqueada',
      narrative: `Se bloqueó ${getBedLabel(asText(details.bedId) || entityId)}${reason ? ` por ${reason}` : ''}.`,
      affectedSubject: getBedLabel(asText(details.bedId) || entityId),
    };
  }

  if (log.action === 'BED_UNBLOCKED') {
    return {
      title: 'Cama desbloqueada',
      narrative: `Se desbloqueó ${getBedLabel(asText(details.bedId) || entityId)}.`,
      affectedSubject: getBedLabel(asText(details.bedId) || entityId),
    };
  }

  if (log.action === 'EXTRA_BED_TOGGLED') {
    const active = typeof details.active === 'boolean' ? details.active : undefined;
    return {
      title: active === false ? 'Cama extra desactivada' : 'Cama extra activada',
      narrative:
        active === false
          ? `Se desactivó ${getBedLabel(asText(details.bedId) || entityId)} como cama extra.`
          : `Se activó ${getBedLabel(asText(details.bedId) || entityId)} como cama extra.`,
      affectedSubject: getBedLabel(asText(details.bedId) || entityId),
    };
  }

  if (log.action === 'DATA_IMPORTED') {
    return {
      title: 'Datos importados',
      narrative: `Se importaron datos clínicos o administrativos en ${getRecordLabel(log)}.`,
      affectedSubject: getRecordLabel(log),
    };
  }

  if (log.action === 'DATA_EXPORTED') {
    return {
      title: 'Datos exportados',
      narrative: `Se exportaron datos clínicos o administrativos desde ${getRecordLabel(log)}.`,
      affectedSubject: getRecordLabel(log),
    };
  }

  if (log.action === 'DATA_ADMISSION_DATES_BACKFILLED') {
    return {
      title: 'Fechas de ingreso corregidas',
      narrative: 'Se ejecutó una corrección administrativa de fechas de ingreso.',
      affectedSubject: getRecordLabel(log),
    };
  }

  if (log.action === 'PATIENT_HARMONIZED') {
    return {
      title: 'Identidad de paciente armonizada',
      narrative: `Se armonizó la identidad clínica asociada a ${patientName}.`,
      affectedSubject: patientName,
    };
  }

  const conflictAutoMergedNarrative = buildConflictAutoMergedAuditNarrative(log, details);
  if (conflictAutoMergedNarrative) return conflictAutoMergedNarrative;

  const clinicalDocumentNarrative = buildClinicalDocumentAuditNarrative({
    log,
    entityLabel: getEntityLabel(log, details),
  });
  if (clinicalDocumentNarrative) return clinicalDocumentNarrative;

  if (log.action === 'PRESCRIPTION_MANUAL_DELETED') {
    return {
      title: 'Receta eliminada manualmente',
      narrative: `Se eliminó manualmente una receta asociada a ${getEntityLabel(log, details)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'PRESCRIPTION_RETENTION_DELETED') {
    return {
      title: 'Receta eliminada por retención histórica',
      narrative: `Se eliminó una receta por política de retención histórica en ${getRecordLabel(log)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  const medicalIndicationNarrative = buildMedicalIndicationAuditNarrative({
    log,
    details,
    entityLabel: getEntityLabel(log, details),
    recordLabel: getRecordLabel(log),
  });
  if (medicalIndicationNarrative) {
    return medicalIndicationNarrative;
  }

  if (log.action === 'WOUND_CARE_PHOTO_UPLOADED') {
    return {
      title: 'Foto clínica de curación subida',
      narrative: `Se subió una foto clínica de curación asociada a ${getEntityLabel(log, details)}.`,
      affectedSubject: getEntityLabel(log, details),
    };
  }

  if (log.action === 'USER_LOGIN') {
    return {
      title: 'Inicio de sesión',
      narrative: 'El usuario inició sesión en el sistema.',
      affectedSubject: getActorLabel(log),
    };
  }

  if (log.action === 'USER_LOGOUT') {
    return {
      title: 'Cierre de sesión',
      narrative: 'El usuario cerró sesión en el sistema.',
      affectedSubject: getActorLabel(log),
    };
  }

  if (log.action === 'SYSTEM_ERROR') {
    return {
      title: 'Evento del sistema registrado',
      narrative: 'Se registró un evento del sistema para revisión administrativa.',
      affectedSubject: entityId || 'Sistema',
    };
  }

  return {
    title: 'Evento registrado',
    narrative: 'Se registró una acción clínica o administrativa para trazabilidad.',
    affectedSubject:
      log.entityType === 'patient' ||
      log.entityType === 'discharge' ||
      log.entityType === 'transfer'
        ? patientName
        : entityId || log.entityType,
  };
};
