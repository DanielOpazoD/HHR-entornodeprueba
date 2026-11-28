import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';

export interface ClinicalDocumentPort {
  get: (documentId: string, hospitalId?: string) => Promise<ClinicalDocumentRecord | null>;
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
  delete: (documentId: string, hospitalId?: string) => Promise<void>;
  subscribeByEpisode: (
    episodeKey: string,
    callback: (documents: ClinicalDocumentRecord[]) => void,
    hospitalId?: string
  ) => () => void;
  subscribeByEpisodeKeys: (
    episodeKeys: string[],
    callback: (documents: ClinicalDocumentRecord[], confirmed?: boolean) => void,
    hospitalId?: string,
    onError?: (error: Error) => void
  ) => () => void;
}

export const defaultClinicalDocumentPort: ClinicalDocumentPort = {
  get: (documentId, hospitalId) => ClinicalDocumentRepository.get(documentId, hospitalId),
  listByEpisode: async (episodeKey, hospitalId) =>
    ClinicalDocumentRepository.listByEpisode(episodeKey, hospitalId),
  listByEpisodeKeys: async (episodeKeys, hospitalId) =>
    ClinicalDocumentRepository.listByEpisodeKeys(episodeKeys, hospitalId),
  saveDraft: async (record, hospitalId) => ClinicalDocumentRepository.saveDraft(record, hospitalId),
  createDraft: async (record, hospitalId) =>
    ClinicalDocumentRepository.createDraft(record, hospitalId),
  delete: async (documentId, hospitalId) =>
    ClinicalDocumentRepository.delete(documentId, hospitalId),
  subscribeByEpisode: (episodeKey, callback, hospitalId) =>
    ClinicalDocumentRepository.subscribeByEpisode(episodeKey, callback, hospitalId),
  subscribeByEpisodeKeys: (episodeKeys, callback, hospitalId, onError) =>
    ClinicalDocumentRepository.subscribeByEpisodeKeys(episodeKeys, callback, hospitalId, onError),
};
