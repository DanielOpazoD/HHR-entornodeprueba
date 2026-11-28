import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import type { QueryOptions } from '@/services/infrastructure/db/types';

interface SubscribeByEpisodeKeysParams {
  episodeKeys: string[];
  callback: (documents: ClinicalDocumentRecord[], confirmed?: boolean) => void;
  onError?: (error: Error) => void;
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
    callback: (data: T[], confirmed?: boolean) => void,
    onError?: (error: Error) => void
  ) => () => void;
}

export const subscribeClinicalDocumentsByEpisodeKeys = ({
  episodeKeys,
  callback,
  onError,
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
  const confirmedChunks = new Set<number>();
  let failed = false;
  const unsubscribes = chunks.map((chunk, index) =>
    subscribeQuery<ClinicalDocumentRecord>(
      collectionPath,
      { where: [{ field: 'episodeKey', operator: 'in', value: chunk }] },
      (docs, confirmed = true) => {
        if (failed) return;
        chunkDocuments.set(index, docs);
        if (confirmed) confirmedChunks.add(index);
        else confirmedChunks.delete(index);
        const documents = normalizeReadDocuments(Array.from(chunkDocuments.values()).flat());
        if (onError) callback(documents, confirmedChunks.size === chunks.length);
        else callback(documents);
      },
      onError &&
        (error => {
          failed = true;
          onError(error);
        })
    )
  );

  return () => unsubscribes.forEach(unsubscribe => unsubscribe());
};
