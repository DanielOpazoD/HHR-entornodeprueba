import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';
import type {
  ClinicalDocumentPdfMeta,
  ClinicalDocumentRecord,
} from '@/features/clinical-documents/internal';

export interface ClinicalDocumentPort {
  listByEpisode: (episodeKey: string, hospitalId?: string) => Promise<ClinicalDocumentRecord[]>;
  listByEpisodeKeys: (
    episodeKeys: string[],
    hospitalId?: string
  ) => Promise<ClinicalDocumentRecord[]>;
  saveDraft: (
    record: ClinicalDocumentRecord,
    hospitalId?: string
  ) => Promise<ClinicalDocumentRecord>;
  createDraft: (
    record: ClinicalDocumentRecord,
    hospitalId?: string
  ) => Promise<ClinicalDocumentRecord>;
  savePdfMetadata: (
    documentId: string,
    pdf: ClinicalDocumentPdfMeta,
    hospitalId?: string
  ) => Promise<void>;
  lockDocumentsByEpisodeKey: (
    episodeKey: string,
    hospitalId?: string,
    options?: { lockedAt?: string }
  ) => Promise<string[]>;
  delete: (documentId: string, hospitalId?: string) => Promise<void>;
  subscribeByEpisode: (
    episodeKey: string,
    callback: (documents: ClinicalDocumentRecord[]) => void,
    hospitalId?: string
  ) => () => void;
  subscribeByEpisodeKeys: (
    episodeKeys: string[],
    callback: (documents: ClinicalDocumentRecord[]) => void,
    hospitalId?: string
  ) => () => void;
}

export const defaultClinicalDocumentPort: ClinicalDocumentPort = {
  listByEpisode: async (episodeKey, hospitalId) =>
    ClinicalDocumentRepository.listByEpisode(episodeKey, hospitalId),
  listByEpisodeKeys: async (episodeKeys, hospitalId) =>
    ClinicalDocumentRepository.listByEpisodeKeys(episodeKeys, hospitalId),
  saveDraft: async (record, hospitalId) => ClinicalDocumentRepository.saveDraft(record, hospitalId),
  createDraft: async (record, hospitalId) =>
    ClinicalDocumentRepository.createDraft(record, hospitalId),
  savePdfMetadata: async (documentId, pdf, hospitalId) =>
    ClinicalDocumentRepository.savePdfMetadata(documentId, pdf, hospitalId),
  lockDocumentsByEpisodeKey: async (episodeKey, hospitalId, options) =>
    ClinicalDocumentRepository.lockDocumentsByEpisodeKey(episodeKey, hospitalId, options),
  delete: async (documentId, hospitalId) =>
    ClinicalDocumentRepository.delete(documentId, hospitalId),
  subscribeByEpisode: (episodeKey, callback, hospitalId) =>
    ClinicalDocumentRepository.subscribeByEpisode(episodeKey, callback, hospitalId),
  subscribeByEpisodeKeys: (episodeKeys, callback, hospitalId) =>
    ClinicalDocumentRepository.subscribeByEpisodeKeys(episodeKeys, callback, hospitalId),
};
