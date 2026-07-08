import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';

export const chunkArray = <T>(values: T[], size: number): T[][] => {
  if (size <= 0) return [values];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

export const normalizeEpisodeKeys = (episodeKeys: string[]): string[] =>
  Array.from(
    new Set(
      episodeKeys.map(episodeKey => episodeKey.trim()).filter(episodeKey => episodeKey.length > 0)
    )
  );

const deduplicateDocuments = (
  documents: ClinicalDocumentRecord[]
): Map<string, ClinicalDocumentRecord> => {
  const deduplicated = new Map<string, ClinicalDocumentRecord>();
  documents.forEach(document => {
    const key = document.id || `${document.episodeKey}-${document.audit?.updatedAt || ''}`;
    deduplicated.set(key, document);
  });
  return deduplicated;
};

export const normalizeClinicalDocumentReadRecords = (
  documents: ClinicalDocumentRecord[],
  validateReadRecord: (record: ClinicalDocumentRecord) => ClinicalDocumentRecord | null,
  sortDocuments: (documents: ClinicalDocumentRecord[]) => ClinicalDocumentRecord[]
): ClinicalDocumentRecord[] =>
  sortDocuments(
    Array.from(deduplicateDocuments(documents).values())
      .map(document => validateReadRecord(document))
      .filter((document): document is ClinicalDocumentRecord => Boolean(document))
  );
