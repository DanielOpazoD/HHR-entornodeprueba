import {
  buildLegacyClinicalDocumentEpisodeLookupKeys,
  parseLegacyClinicalEpisodeKey,
  type LegacyClinicalEpisodeKeyParts,
} from '@/application/patient-flow/clinicalEpisode';
import type { ClinicalDocSummary } from '@/features/census/components/global-search/globalSearchContracts';

export type PatientSelectionEpisodeLookupKey = LegacyClinicalEpisodeKeyParts;

export const parsePatientSelectionEpisodeLookupKey = (
  key: string
): PatientSelectionEpisodeLookupKey | null => parseLegacyClinicalEpisodeKey(key);

export const buildPatientSelectionDocumentLookupKeys = (
  key: PatientSelectionEpisodeLookupKey
): string[] => buildLegacyClinicalDocumentEpisodeLookupKeys(key);

interface ClinicalDocumentSummarySource {
  id?: string;
  episodeKey?: string;
  documentType?: string;
  status?: string;
  audit?: {
    createdAt?: string;
    createdBy?: {
      displayName?: string;
    };
    updatedAt?: string;
  };
}

export const summarizeClinicalDocuments = (
  documents: ClinicalDocumentSummarySource[],
  fallbackEpisodeKey: string
): ClinicalDocSummary[] =>
  documents.map(document => ({
    id: document.id || '',
    episodeKey: document.episodeKey || fallbackEpisodeKey,
    documentType: document.documentType || '',
    status: document.status || '',
    createdAt: document.audit?.createdAt || '',
    createdBy: document.audit?.createdBy?.displayName || '',
    updatedAt: document.audit?.updatedAt || '',
  }));
