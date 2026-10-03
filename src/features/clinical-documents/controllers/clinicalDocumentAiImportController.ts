import { buildClinicalDocumentVersionSectionSnapshots } from '@/domain/clinical-documents/versionHistory';
import {
  buildClinicalDocumentRenderedText,
  createClinicalDocumentDraft,
} from '@/features/clinical-documents/domain/factories';
import type {
  ClinicalDocumentAuditActor,
  ClinicalDocumentEpisodeContext,
  ClinicalDocumentRecord,
  ClinicalDocumentSection,
} from '@/features/clinical-documents/domain/entities';
import { createClinicalDocumentHash } from '@/domain/clinical-documents/hash';
import {
  normalizeClinicalDocumentAiImportText,
  type ClinicalDocumentAiImportPayload,
} from '@/features/clinical-documents/contracts/clinicalDocumentAiImportContract';

export {
  CLINICAL_DOCUMENT_AI_IMPORT_MAX_FILE_BYTES,
  normalizeClinicalDocumentAiImportText,
  parseClinicalDocumentAiImportJson,
  sanitizeClinicalDocumentAiImportSourceText,
  validateClinicalDocumentAiImportFile,
  validateClinicalDocumentAiImportSourceText,
  type ClinicalDocumentAiImportFileLike,
  type ClinicalDocumentAiImportParseResult,
  type ClinicalDocumentAiImportPayload,
  type ClinicalDocumentAiImportValidationResult,
} from '@/features/clinical-documents/contracts/clinicalDocumentAiImportContract';

const escapeClinicalDocumentHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildClinicalDocumentAiImportSectionHtml = (value: string): string => {
  const normalized = normalizeClinicalDocumentAiImportText(value);
  if (!normalized) return '';

  return normalized
    .split(/\n{2,}/)
    .map(paragraph => `<p>${escapeClinicalDocumentHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
};

export const buildClinicalDocumentAiImportSections = (
  payload: ClinicalDocumentAiImportPayload
): ClinicalDocumentSection[] => [
  {
    id: 'antecedentes',
    title: 'Antecedentes',
    content: buildClinicalDocumentAiImportSectionHtml(payload.antecedentes),
    order: 0,
    required: true,
    visible: true,
  },
  {
    id: 'historia-evolucion',
    title: 'Historia y evolución clínica',
    content: buildClinicalDocumentAiImportSectionHtml(payload.historiaEvolucionClinica),
    order: 1,
    required: true,
    visible: true,
  },
  {
    id: 'examenes-complementarios',
    title: 'Exámenes complementarios',
    content: buildClinicalDocumentAiImportSectionHtml(payload.examenesComplementarios),
    order: 2,
    required: false,
    visible: true,
  },
  {
    id: 'diagnosticos',
    title: 'Diagnósticos de egreso',
    content: buildClinicalDocumentAiImportSectionHtml(payload.diagnosticosEgreso),
    order: 3,
    required: false,
    visible: true,
  },
  {
    id: 'plan',
    title: 'Plan de egreso',
    content: buildClinicalDocumentAiImportSectionHtml(payload.planEgreso),
    order: 4,
    required: true,
    visible: true,
  },
];

interface BuildClinicalDocumentAiImportedRecordParams {
  payload: ClinicalDocumentAiImportPayload;
  hospitalId: string;
  actor: ClinicalDocumentAuditActor;
  episode: ClinicalDocumentEpisodeContext;
  patientFieldValues: Record<string, string>;
  medico: string;
  especialidad: string;
}

export const buildClinicalDocumentAiImportedRecord = ({
  payload,
  hospitalId,
  actor,
  episode,
  patientFieldValues,
  medico,
  especialidad,
}: BuildClinicalDocumentAiImportedRecordParams): ClinicalDocumentRecord => {
  const importedRecord = createClinicalDocumentDraft({
    templateId: 'epicrisis_traslado',
    hospitalId,
    actor,
    episode,
    patientFieldValues,
    medico,
    especialidad,
  });
  const recordWithSections: ClinicalDocumentRecord = {
    ...importedRecord,
    sections: buildClinicalDocumentAiImportSections(payload),
    title: 'Epicrisis traslado',
  };
  const renderedText = buildClinicalDocumentRenderedText(recordWithSections);
  const sectionSnapshots = buildClinicalDocumentVersionSectionSnapshots(recordWithSections);

  return {
    ...recordWithSections,
    renderedText,
    integrityHash: createClinicalDocumentHash(renderedText),
    versionHistory: recordWithSections.versionHistory.map(version =>
      version.version === 1
        ? {
            ...version,
            reason: 'ai_import',
            changedSectionIds: sectionSnapshots.map(snapshot => snapshot.sectionId),
            sectionSnapshots,
          }
        : version
    ),
  };
};
