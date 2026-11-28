import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import type { QueryOptions } from '@/services/infrastructure/db/types';

interface SubscribeByEpisodeKeysParams {
  episodeKeys: string[];
  callback: (documents: ClinicalDocumentRecord[]) => void;
  hospitalId: string;
  firestoreEnabled: boolean;
  collectionPath: string;
  chunkSize: number;
  normalizeEpisodeKeys: (episodeKeys: string[]) => string[];
  chunkArray: <T>(values: T[], size: number) => T[][];
  subscribeLocalEpisodeDocuments: (
    episodeKeys: string[],
    callback: (documents: ClinicalDocumentRecord[]) => void,
    hospitalId: string
  ) => () => void;
  normalizeReadDocuments: (documents: ClinicalDocumentRecord[]) => ClinicalDocumentRecord[];
  subscribeQuery: <T>(
    collectionName: string,
    options: QueryOptions,
    callback: (data: T[]) => void
  ) => () => void;
}

export const subscribeClinicalDocumentsByEpisodeKeys = ({
  episodeKeys,
  callback,
  hospitalId,
  firestoreEnabled,
  collectionPath,
  chunkSize,
  normalizeEpisodeKeys,
  chunkArray,
  subscribeLocalEpisodeDocuments,
  normalizeReadDocuments,
  subscribeQuery,
}: SubscribeByEpisodeKeysParams): (() => void) => {
  const sanitizedEpisodeKeys = normalizeEpisodeKeys(episodeKeys);
  if (sanitizedEpisodeKeys.length === 0) {
    callback([]);
    return () => undefined;
  }

  if (!firestoreEnabled) {
    return subscribeLocalEpisodeDocuments(sanitizedEpisodeKeys, callback, hospitalId);
  }

  const chunks = chunkArray(sanitizedEpisodeKeys, chunkSize);
  const chunkDocuments = new Map<number, ClinicalDocumentRecord[]>();
  const emit = () => {
    callback(normalizeReadDocuments(Array.from(chunkDocuments.values()).flat()));
  };
  const unsubscribes = chunks.map((chunk, index) =>
    subscribeQuery<ClinicalDocumentRecord>(
      collectionPath,
      { where: [{ field: 'episodeKey', operator: 'in', value: chunk }] },
      docs => {
        chunkDocuments.set(index, docs);
        emit();
      }
    )
  );

  return () => unsubscribes.forEach(unsubscribe => unsubscribe());
};
