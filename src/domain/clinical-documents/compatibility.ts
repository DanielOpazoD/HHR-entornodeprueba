import type {
  ClinicalDocumentAuditActor,
  ClinicalDocumentRecord,
} from '@/domain/clinical-documents/entities';
import { getClinicalDocumentDefinition } from '@/domain/clinical-documents/definitions';
import {
  CURRENT_CLINICAL_DOCUMENT_SCHEMA_VERSION,
  LEGACY_CLINICAL_DOCUMENT_SCHEMA_VERSION,
} from '@/domain/clinical-documents/schema';

const LEGACY_AUDIT_ACTOR_DEFAULTS: ClinicalDocumentAuditActor = {
  uid: 'legacy-unknown',
  email: 'legacy@unknown.local',
  displayName: 'Usuario legado',
  role: 'legacy_unknown',
};

const normalizeClinicalDocumentSectionTitle = (title: string, fallback: string): string => {
  const normalized = title.trim().replace(/\s+/g, ' ');
  return normalized || fallback;
};

export const resolveClinicalDocumentSchemaVersion = (
  record: Partial<ClinicalDocumentRecord> | null | undefined
): number => {
  const rawVersion = record?.schemaVersion;
  if (typeof rawVersion !== 'number' || !Number.isFinite(rawVersion)) {
    return LEGACY_CLINICAL_DOCUMENT_SCHEMA_VERSION;
  }
  return Math.max(LEGACY_CLINICAL_DOCUMENT_SCHEMA_VERSION, Math.floor(rawVersion));
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

const readLegacyActorField = (
  input: Record<string, unknown>,
  key: keyof ClinicalDocumentAuditActor
): string => {
  const value = input[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : LEGACY_AUDIT_ACTOR_DEFAULTS[key];
};

const normalizeAuditActor = (input: unknown): ClinicalDocumentAuditActor => {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  return {
    uid: readLegacyActorField(source, 'uid'),
    email: readLegacyActorField(source, 'email'),
    displayName: readLegacyActorField(source, 'displayName'),
    role: readLegacyActorField(source, 'role'),
  };
};

const normalizeOptionalAuditActor = (input: unknown): ClinicalDocumentAuditActor | undefined => {
  if (input === null || input === undefined) {
    return undefined;
  }
  return normalizeAuditActor(input);
};

const normalizeLegacyAuditActors = (record: ClinicalDocumentRecord): ClinicalDocumentRecord => {
  const audit = record.audit as ClinicalDocumentRecord['audit'] | undefined;
  const signatureRevocations = Array.isArray(audit?.signatureRevocations)
    ? audit.signatureRevocations.map(revocation => ({
        ...revocation,
        revokedBy: normalizeAuditActor(
          (revocation as { revokedBy?: ClinicalDocumentAuditActor }).revokedBy
        ),
      }))
    : [];

  return {
    ...record,
    versionHistory: Array.isArray(record.versionHistory)
      ? record.versionHistory.map(version => ({
          ...version,
          savedBy: normalizeAuditActor(version.savedBy),
        }))
      : record.versionHistory,
    audit: {
      ...record.audit,
      createdBy: normalizeAuditActor(audit?.createdBy),
      updatedBy: normalizeAuditActor(audit?.updatedBy),
      signedBy: normalizeOptionalAuditActor(audit?.signedBy),
      unsignedBy: normalizeOptionalAuditActor(audit?.unsignedBy),
      archivedBy: normalizeOptionalAuditActor(audit?.archivedBy),
      signatureRevocations,
    },
  };
};

export const hydrateClinicalDocumentV1ToCurrent = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord => applyClinicalDocumentDefinitionDefaults(record);

export const hydrateLegacyClinicalDocument = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord => {
  const schemaVersion = resolveClinicalDocumentSchemaVersion(record);
  const hydrated =
    schemaVersion <= LEGACY_CLINICAL_DOCUMENT_SCHEMA_VERSION
      ? hydrateClinicalDocumentV1ToCurrent(record)
      : applyClinicalDocumentDefinitionDefaults(record);

  return normalizeLegacyAuditActors(hydrated);
};

export const normalizeClinicalDocumentForPersistence = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord => applyClinicalDocumentDefinitionDefaults(record);
