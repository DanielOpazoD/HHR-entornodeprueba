import type { AuditLogEntry } from '@/types/auditLogTypes';

interface ClinicalAuditNarrative {
  title: string;
  narrative: string;
  affectedSubject: string;
}

interface MedicalIndicationAuditNarrativeInput {
  log: AuditLogEntry;
  details: Record<string, unknown>;
  entityLabel: string;
  recordLabel: string;
}

const personalIndicationSubject = (details: Record<string, unknown>, entityId: string): string =>
  String(details.textPreview || entityId || 'Indicación personal');

export const buildMedicalIndicationAuditNarrative = ({
  log,
  details,
  entityLabel,
  recordLabel,
}: MedicalIndicationAuditNarrativeInput): ClinicalAuditNarrative | null => {
  if (log.action === 'MEDICAL_INDICATION_RECORD_CREATED') {
    return {
      title: 'Indicaciones médicas generadas',
      narrative: `Se generó un set de indicaciones médicas para ${entityLabel} en ${recordLabel}.`,
      affectedSubject: entityLabel,
    };
  }

  if (log.action === 'MEDICAL_INDICATION_TEMPLATE_CREATED') {
    return {
      title: 'Indicación personal creada',
      narrative: 'Se guardó una indicación médica personal reutilizable.',
      affectedSubject: personalIndicationSubject(details, log.entityId),
    };
  }

  if (log.action === 'MEDICAL_INDICATION_TEMPLATE_UPDATED') {
    return {
      title: 'Indicación personal editada',
      narrative: 'Se editó una indicación médica personal reutilizable.',
      affectedSubject: personalIndicationSubject(details, log.entityId),
    };
  }

  if (log.action === 'MEDICAL_INDICATION_TEMPLATE_ARCHIVED') {
    return {
      title: 'Indicación personal archivada',
      narrative: 'Se archivó una indicación médica personal reutilizable.',
      affectedSubject: log.entityId || 'Indicación personal',
    };
  }

  if (log.action === 'MEDICAL_INDICATION_TEMPLATE_USED') {
    return {
      title: 'Indicación personal reutilizada',
      narrative: 'Se insertó una indicación médica guardada en el editor.',
      affectedSubject: personalIndicationSubject(details, log.entityId),
    };
  }

  return null;
};
