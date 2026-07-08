import type {
  ClinicalDocumentRecord,
  ClinicalDocumentTemplate,
} from '@/features/clinical-documents/domain/entities';
import { isLegacyClinicalEpisodeKey } from '@/application/patient-flow/clinicalEpisode';

export const resolveSelectedClinicalTemplateId = (
  templates: ClinicalDocumentTemplate[],
  selectedTemplateId: string
): string => {
  if (templates.some(template => template.id === selectedTemplateId)) {
    return selectedTemplateId;
  }

  return templates[0]?.id || 'epicrisis';
};

export const shouldSeedClinicalDocumentTemplates = ({
  isActive,
  role,
  hasLoadedRemoteTemplates,
  remoteTemplateCount,
}: {
  isActive: boolean;
  role: string;
  hasLoadedRemoteTemplates: boolean;
  remoteTemplateCount: number | null;
}): boolean =>
  isActive &&
  role === 'admin' &&
  hasLoadedRemoteTemplates &&
  remoteTemplateCount !== null &&
  remoteTemplateCount === 0;

const normalizePatientRut = (rut?: string): string =>
  String(rut || '')
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();

const resolveDocumentRut = (document: ClinicalDocumentRecord): string => {
  const explicitRut = normalizePatientRut(document.patientRut);
  if (explicitRut) {
    return explicitRut;
  }

  const fieldRut = document.patientFields.find(
    field => field.id === 'rut' || field.id === 'patientRut'
  );
  return normalizePatientRut(fieldRut?.value);
};

const filterDocumentsForCurrentPatientIdentity = (
  documents: ClinicalDocumentRecord[],
  currentPatientRut?: string
): ClinicalDocumentRecord[] => {
  const normalizedCurrentRut = normalizePatientRut(currentPatientRut);
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
