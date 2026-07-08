import type { AuditLogEntry } from '@/types/auditLogTypes';

interface ClinicalAuditNarrative {
  title: string;
  narrative: string;
  affectedSubject: string;
}

export const buildClinicalDocumentAuditNarrative = ({
  log,
  entityLabel,
}: {
  log: AuditLogEntry;
  entityLabel: string;
}): ClinicalAuditNarrative | null => {
  if (log.action === 'CLINICAL_DOCUMENT_CREATED') {
    return {
      title: 'Documento clínico creado',
      narrative: `Se creó un documento clínico asociado a ${entityLabel}.`,
      affectedSubject: entityLabel,
    };
  }

  if (log.action === 'CLINICAL_DOCUMENT_EDITED') {
    return {
      title: 'Documento clínico editado',
      narrative: `Se editó un documento clínico asociado a ${entityLabel}.`,
      affectedSubject: entityLabel,
    };
  }

  if (log.action === 'CLINICAL_DOCUMENT_EXPORTED') {
    return {
      title: 'Documento clínico exportado',
      narrative: `Se exportó un documento clínico asociado a ${entityLabel}.`,
      affectedSubject: entityLabel,
    };
  }

  if (log.action === 'CLINICAL_DOCUMENT_PRINTED') {
    return {
      title: 'Documento clínico impreso',
      narrative: `Se preparó la impresión de un documento clínico asociado a ${entityLabel}.`,
      affectedSubject: entityLabel,
    };
  }

  if (log.action === 'CLINICAL_DOCUMENT_DELETED') {
    return {
      title: 'Documento clínico eliminado',
      narrative: `Se eliminó un documento clínico asociado a ${entityLabel}.`,
      affectedSubject: entityLabel,
    };
  }

  if (log.action === 'CLINICAL_DOCUMENT_LOCKED') {
    return {
      title: 'Documento clínico bloqueado',
      narrative: `Se bloqueó un documento clínico asociado a ${entityLabel}.`,
      affectedSubject: entityLabel,
    };
  }

  return null;
};
