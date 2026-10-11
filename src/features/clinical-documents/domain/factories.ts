import { createClinicalDocumentHash } from '@/domain/clinical-documents/hash';
import type {
  ClinicalDocumentAuditActor,
  ClinicalDocumentEpisodeContext,
  ClinicalDocumentPatientField,
  ClinicalDocumentRecord,
  ClinicalDocumentSection,
  ClinicalDocumentTemplate,
} from '@/features/clinical-documents/domain/entities';
import { stripClinicalDocumentHtml } from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';
import {
  CLINICAL_DOCUMENT_TEMPLATES,
  DEFAULT_CLINICAL_DOCUMENT_TEMPLATE_ID,
} from '@/features/clinical-documents/domain/rules';
import { CURRENT_CLINICAL_DOCUMENT_SCHEMA_VERSION } from '@/features/clinical-documents/domain/schema';
import { buildClinicalDocumentVersionSectionSnapshots } from '@/domain/clinical-documents/versionHistory';

const clonePatientFields = (
  template: ClinicalDocumentTemplate,
  values: Record<string, string>
): ClinicalDocumentPatientField[] =>
  template.patientFields.map(field => ({
    ...field,
    value: values[field.id] || '',
    visible: field.visible ?? true,
  }));

const cloneSections = (template: ClinicalDocumentTemplate): ClinicalDocumentSection[] =>
  template.sections.map(section => ({
    id: section.id,
    title: section.title,
    content: '',
    order: section.order,
    kind: section.kind,
    required: section.required,
    visible: section.visible ?? true,
  }));

export const getClinicalDocumentTemplate = (templateId?: string): ClinicalDocumentTemplate =>
  CLINICAL_DOCUMENT_TEMPLATES[templateId || DEFAULT_CLINICAL_DOCUMENT_TEMPLATE_ID] ||
  CLINICAL_DOCUMENT_TEMPLATES[DEFAULT_CLINICAL_DOCUMENT_TEMPLATE_ID];

/**
 * Restores a draft document to match a template structure.
 *
 * When `preserveContent` is true (default for template type changes),
 * sections are matched by ID and their content is kept if the new
 * template has a section with the same ID.
 *
 * When `preserveContent` is false (used by "Restablecer" button),
 * all section content is cleared to empty strings.
 *
 * Patient field values are always preserved regardless of the flag.
 */
export const restoreClinicalDocumentDraftTemplate = (
  record: ClinicalDocumentRecord,
  templateId = record.templateId,
  preserveContent = false
): ClinicalDocumentRecord => {
  const template = getClinicalDocumentTemplate(templateId);
  const patientFieldValues = Object.fromEntries(
    record.patientFields.map(field => [field.id, field.value])
  );
  const existingSectionContent = preserveContent
    ? new Map(record.sections.map(s => [s.id, s.content]))
    : new Map<string, string>();
  const restoredRecord: ClinicalDocumentRecord = {
    ...record,
    documentType: template.documentType,
    templateId: template.id,
    templateVersion: template.version,
    title: template.title,
    patientInfoTitle: template.defaultPatientInfoTitle,
    footerMedicoLabel: template.defaultFooterMedicoLabel,
    footerEspecialidadLabel: template.defaultFooterEspecialidadLabel,
    patientFields: clonePatientFields(template, patientFieldValues),
    sections: template.sections.map(section => ({
      id: section.id,
      title: section.title,
      content: existingSectionContent.get(section.id) || '',
      order: section.order,
      kind: section.kind,
      required: section.required,
      visible: section.visible ?? true,
    })),
    pdf: undefined,
  };
  const renderedText = buildClinicalDocumentRenderedText(restoredRecord);
  return {
    ...restoredRecord,
    renderedText,
    integrityHash: createClinicalDocumentHash(renderedText),
  };
};

export const buildClinicalDocumentRenderedText = (
  record: Pick<
    ClinicalDocumentRecord,
    | 'title'
    | 'patientInfoTitle'
    | 'patientFields'
    | 'sections'
    | 'footerMedicoLabel'
    | 'footerEspecialidadLabel'
    | 'medico'
    | 'especialidad'
  >
): string => {
  const patientBlock = record.patientFields
    .filter(field => field.visible !== false)
    .map(field => `${field.label}: ${field.value || '—'}`)
    .join('\n');
  const sectionsBlock = record.sections
    .filter(section => section.visible !== false)
    .map(
      section =>
        `${section.title}\n${stripClinicalDocumentHtml(section.content) || 'Sin contenido registrado.'}`
    )
    .join('\n\n');

  return [
    record.title,
    record.patientInfoTitle || 'Información del Paciente',
    patientBlock,
    sectionsBlock,
    `${record.footerMedicoLabel || 'Médico'}: ${record.medico || '—'}`,
    `${record.footerEspecialidadLabel || 'Especialidad'}: ${record.especialidad || '—'}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();
};

interface CreateClinicalDocumentDraftParams {
  templateId?: string;
  hospitalId: string;
  actor: ClinicalDocumentAuditActor;
  episode: ClinicalDocumentEpisodeContext;
  patientFieldValues: Record<string, string>;
  medico: string;
  especialidad: string;
}

const buildDuplicateClinicalDocumentTitle = (title: string): string =>
  /\(copia\)$/i.test(title.trim()) ? title.trim() : `${title.trim()} (copia)`;

export const createClinicalDocumentDraft = ({
  templateId,
  hospitalId,
  actor,
  episode,
  patientFieldValues,
  medico,
  especialidad,
}: CreateClinicalDocumentDraftParams): ClinicalDocumentRecord => {
  const template = getClinicalDocumentTemplate(templateId);
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `clinical-document-${Date.now()}`;
  const now = new Date().toISOString();
  const patientFields = clonePatientFields(template, patientFieldValues);
  const sections = cloneSections(template);

  const draft: ClinicalDocumentRecord = {
    id,
    schemaVersion: CURRENT_CLINICAL_DOCUMENT_SCHEMA_VERSION,
    hospitalId,
    documentType: template.documentType,
    templateId: template.id,
    templateVersion: template.version,
    title: template.title,
    patientInfoTitle: template.defaultPatientInfoTitle,
    footerMedicoLabel: template.defaultFooterMedicoLabel,
    footerEspecialidadLabel: template.defaultFooterEspecialidadLabel,
    patientRut: episode.patientRut,
    patientName: episode.patientName,
    episodeKey: episode.episodeKey,
    admissionDate: episode.admissionDate,
    sourceDailyRecordDate: episode.sourceDailyRecordDate,
    sourceBedId: episode.sourceBedId,
    patientFields,
    sections,
    medico,
    especialidad,
    status: 'draft',
    isLocked: false,
    isActiveEpisodeDocument: true,
    currentVersion: 1,
    versionHistory: [
      {
        version: 1,
        savedAt: now,
        savedBy: actor,
        reason: 'manual',
      },
    ],
    audit: {
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    },
    annexIncludedInPrint: true,
    includePatientSignature: true,
    renderedText: '',
    integrityHash: '',
  };

  const initialSectionSnapshots = buildClinicalDocumentVersionSectionSnapshots(draft);
  const renderedText = buildClinicalDocumentRenderedText(draft);
  return {
    ...draft,
    versionHistory: draft.versionHistory.map(version =>
      version.version === 1
        ? {
            ...version,
            changedSectionIds: initialSectionSnapshots.map(snapshot => snapshot.sectionId),
            sectionSnapshots: initialSectionSnapshots,
          }
        : version
    ),
    renderedText,
    integrityHash: createClinicalDocumentHash(renderedText),
  };
};

export const duplicateClinicalDocumentDraft = (
  record: ClinicalDocumentRecord,
  actor: ClinicalDocumentAuditActor
): ClinicalDocumentRecord => {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `clinical-document-${Date.now()}`;
  const now = new Date().toISOString();

  const duplicatedRecord: ClinicalDocumentRecord = {
    ...structuredClone(record),
    id,
    title: buildDuplicateClinicalDocumentTitle(record.title),
    status: 'draft',
    isLocked: false,
    isActiveEpisodeDocument: true,
    currentVersion: 1,
    versionHistory: [
      {
        version: 1,
        savedAt: now,
        savedBy: actor,
        reason: 'manual',
      },
    ],
    audit: {
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    },
    pdf: undefined,
  };

  const initialSectionSnapshots = buildClinicalDocumentVersionSectionSnapshots(duplicatedRecord);
  const renderedText = buildClinicalDocumentRenderedText(duplicatedRecord);
  return {
    ...duplicatedRecord,
    versionHistory: duplicatedRecord.versionHistory.map(version =>
      version.version === 1
        ? {
            ...version,
            changedSectionIds: initialSectionSnapshots.map(snapshot => snapshot.sectionId),
            sectionSnapshots: initialSectionSnapshots,
          }
        : version
    ),
    renderedText,
    integrityHash: createClinicalDocumentHash(renderedText),
  };
};
