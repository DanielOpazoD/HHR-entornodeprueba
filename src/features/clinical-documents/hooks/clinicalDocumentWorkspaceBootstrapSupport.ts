import type {
  ClinicalDocumentRecord,
  ClinicalDocumentTemplate,
} from '@/domain/clinical-documents/entities';
import { isLegacyClinicalEpisodeKey } from '@/application/patient-flow/clinicalEpisode';
import { normalizeRut } from '@/utils/rutUtils';

export const resolveSelectedClinicalTemplateId = (
  templates: ClinicalDocumentTemplate[],
  selectedTemplateId: string
): string => {
  if (templates.some(template => template.id === selectedTemplateId)) {
    return selectedTemplateId;
  }

  return templates[0]?.id || 'epicrisis';
};

const resolveDocumentRut = (document: ClinicalDocumentRecord): string => {
  const explicitRut = normalizeRut(document.patientRut);
  if (explicitRut) {
    return explicitRut;
  }

  const fieldRut = document.patientFields.find(
    field => field.id === 'rut' || field.id === 'patientRut'
  );
  return normalizeRut(fieldRut?.value);
};

const filterDocumentsForCurrentPatientIdentity = (
  documents: ClinicalDocumentRecord[],
  currentPatientRut?: string
): ClinicalDocumentRecord[] => {
  const normalizedCurrentRut = normalizeRut(currentPatientRut);
  if (!normalizedCurrentRut) {
    return documents;
  }

  return documents.filter(document => {
    const documentRut = resolveDocumentRut(document);
    return !documentRut || documentRut === normalizedCurrentRut;
  });
};

export const filterClinicalDocumentsForCurrentEpisode = ({
  documents,
  currentEpisodeKey,
  allowedEpisodeKeys,
  currentPatientRut,
}: {
  documents: ClinicalDocumentRecord[];
  currentEpisodeKey: string;
  allowedEpisodeKeys: string[];
  currentPatientRut?: string;
}): ClinicalDocumentRecord[] => {
  if (!isLegacyClinicalEpisodeKey(currentEpisodeKey)) {
    return filterDocumentsForCurrentPatientIdentity(
      documents.filter(document => document.episodeKey === currentEpisodeKey),
      currentPatientRut
    );
  }

  const allowed = new Set(allowedEpisodeKeys);
  return filterDocumentsForCurrentPatientIdentity(
    documents.filter(document => allowed.has(document.episodeKey)),
    currentPatientRut
  );
};

export const resolveNextSelectedClinicalDocumentId = (
  documents: ClinicalDocumentRecord[],
  previousSelectedDocumentId: string | null
): string | null => {
  if (!previousSelectedDocumentId) {
    return documents[0]?.id || null;
  }

  return documents.some(document => document.id === previousSelectedDocumentId)
    ? previousSelectedDocumentId
    : documents[0]?.id || null;
};
