import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import type { QueryOptions } from '@/services/infrastructure/db/types';

type LocalSubscribers = Map<string, Set<(documents: ClinicalDocumentRecord[]) => void>>;

interface SubscribeByEpisodeKeysParams {
  episodeKeys: string[];
  callback: (documents: ClinicalDocumentRecord[]) => void;
  hospitalId: string;
  firestoreEnabled: boolean;
  collectionPath: string;
  chunkSize: number;
  localSubscribers: LocalSubscribers;
  normalizeEpisodeKeys: (episodeKeys: string[]) => string[];
  chunkArray: <T>(values: T[], size: number) => T[][];
  listLocalClinicalDocumentsByEpisode: (
    episodeKey: string,
    hospitalId: string
  ) => ClinicalDocumentRecord[];
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
  localSubscribers,
  normalizeEpisodeKeys,
  chunkArray,
  listLocalClinicalDocumentsByEpisode,
  normalizeReadDocuments,
  subscribeQuery,
}: SubscribeByEpisodeKeysParams): (() => void) => {
  const sanitizedEpisodeKeys = normalizeEpisodeKeys(episodeKeys);
  if (sanitizedEpisodeKeys.length === 0) {
    callback([]);
    return () => undefined;
  }

  if (!firestoreEnabled) {
    const emit = () => {
      callback(
        normalizeReadDocuments(
          sanitizedEpisodeKeys.flatMap(episodeKey =>
            listLocalClinicalDocumentsByEpisode(episodeKey, hospitalId)
          )
        )
      );
    };
    const unsubscribes = sanitizedEpisodeKeys.map(episodeKey => {
      const key = `${hospitalId}::${episodeKey}`;
      const subscribers = localSubscribers.get(key) || new Set();
      subscribers.add(emit);
      localSubscribers.set(key, subscribers);
      return () => {
        subscribers.delete(emit);
        if (subscribers.size === 0) {
          localSubscribers.delete(key);
        }
      };
    });
    emit();
    return () => unsubscribes.forEach(unsubscribe => unsubscribe());
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
