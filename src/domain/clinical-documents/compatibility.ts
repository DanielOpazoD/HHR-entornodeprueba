import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import { getClinicalDocumentDefinition } from '@/domain/clinical-documents/definitions';
import { CURRENT_CLINICAL_DOCUMENT_SCHEMA_VERSION } from '@/domain/clinical-documents/schema';

const normalizeClinicalDocumentSectionTitle = (title: string, fallback: string): string => {
  const normalized = title.trim().replace(/\s+/g, ' ');
  return normalized || fallback;
};

const applyClinicalDocumentDefinitionDefaults = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord => {
  const audit = record.audit as ClinicalDocumentRecord['audit'] | undefined;
  const definition = getClinicalDocumentDefinition(record.documentType);
  const normalizedSections = definition.sectionNormalizers.reduce(
    (sections, normalize) => normalize(sections),
    record.sections
  );
  const patientFields = record.patientFields.map(field => ({
    ...field,
    label: definition.resolvePatientFieldLabel?.(field) || field.label,
  }));

  return {
    ...record,
    schemaVersion: CURRENT_CLINICAL_DOCUMENT_SCHEMA_VERSION,
    status:
      record.status === 'signed' || record.status === 'ready_for_signature'
        ? 'draft'
        : record.status,
    // Preserve the lock only when a recognized lock reason is recorded.
    // Bare `isLocked: true` without metadata is the legacy signature-era
    // lock (since retired) and must reset to false. The new
    // episode-close lock always carries `lockedReason='episode_closed'`
    // and survives both reads and persistence.
    isLocked: Boolean(record.lockedReason),
    patientFields,
    sections: normalizedSections.map((section, index) => ({
      ...section,
      title: normalizeClinicalDocumentSectionTitle(section.title, `Sección ${index + 1}`),
    })),
    patientInfoTitle: record.patientInfoTitle || 'Información del Paciente',
    footerMedicoLabel: record.footerMedicoLabel || 'Médico',
    footerEspecialidadLabel: record.footerEspecialidadLabel || 'Especialidad',
    annexIncludedInPrint: record.annexIncludedInPrint ?? true,
    includePatientSignature: record.includePatientSignature ?? true,
    audit: {
      ...record.audit,
      signatureRevocations: Array.isArray(audit?.signatureRevocations)
        ? audit.signatureRevocations
        : [],
    },
  };
};

/** Normalizes a stored clinical document to current definition defaults. */
export const hydrateClinicalDocumentRecord = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord => applyClinicalDocumentDefinitionDefaults(record);

export const normalizeClinicalDocumentForPersistence = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord => applyClinicalDocumentDefinitionDefaults(record);
