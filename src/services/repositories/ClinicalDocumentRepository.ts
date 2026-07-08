import { firestoreDb } from '@/services/storage/firestore';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import type {
  ClinicalDocumentPdfMeta,
  ClinicalDocumentRecord,
} from '@/domain/clinical-documents/entities';
import {
  buildClinicalDocumentIntegrityHash,
  buildClinicalDocumentRenderedText,
} from '@/domain/clinical-documents/rendering';
import {
  hydrateClinicalDocumentRecord,
  normalizeClinicalDocumentRecordForStorage,
} from '@/application/ports/clinicalDocumentCompatibilityPort';
import {
  formatClinicalDocumentContractIssues,
  parseClinicalDocumentRecord,
  safeParseClinicalDocumentRecord,
} from '@/domain/clinical-documents/runtimeContracts';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { executeLockDocumentsByEpisodeKey } from '@/services/repositories/clinicalDocumentRepositoryLockSupport';
import {
  chunkArray,
  normalizeClinicalDocumentReadRecords,
  normalizeEpisodeKeys,
} from '@/services/repositories/clinicalDocumentRepositoryReadSupport';
import { subscribeClinicalDocumentsByEpisodeKeys } from '@/services/repositories/clinicalDocumentRepositorySubscriptionSupport';

const getClinicalDocumentsCollectionPath = (hospitalId: string = getActiveHospitalId()): string =>
  `hospitals/${hospitalId}/clinicalDocuments`;

const EPISODE_KEY_QUERY_CHUNK_SIZE = 10;
const LOCAL_CLINICAL_DOCUMENTS_STORAGE_KEY = 'hhr_clinical_documents_local_v1';

type LocalClinicalDocumentsStore = Record<string, Record<string, ClinicalDocumentRecord>>;

const localClinicalDocumentsMemoryStore: LocalClinicalDocumentsStore = {};
const localClinicalDocumentSubscribers = new Map<
  string,
  Set<(documents: ClinicalDocumentRecord[]) => void>
>();

const sortDocuments = (documents: ClinicalDocumentRecord[]): ClinicalDocumentRecord[] =>
  [...documents].sort((left, right) => right.audit.updatedAt.localeCompare(left.audit.updatedAt));

const sanitizeForFirestore = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map(item => sanitizeForFirestore(item))
      .filter(item => item !== undefined) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, sanitizeForFirestore(nested)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
};

const getBrowserStorage = (): Storage | null => {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
};

const readLocalClinicalDocumentsStore = (): LocalClinicalDocumentsStore => {
  const storage = getBrowserStorage();
  if (!storage) {
    return localClinicalDocumentsMemoryStore;
  }

  try {
    const raw = storage.getItem(LOCAL_CLINICAL_DOCUMENTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalClinicalDocumentsStore) : {};
  } catch {
    return {};
  }
};

const writeLocalClinicalDocumentsStore = (store: LocalClinicalDocumentsStore): void => {
  Object.keys(localClinicalDocumentsMemoryStore).forEach(key => {
    delete localClinicalDocumentsMemoryStore[key];
  });
  Object.assign(localClinicalDocumentsMemoryStore, store);

  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(LOCAL_CLINICAL_DOCUMENTS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Local-only persistence is best-effort; callers still receive the in-memory document.
  }
};

const listLocalClinicalDocumentsByEpisode = (
  episodeKey: string,
  hospitalId: string
): ClinicalDocumentRecord[] => {
  const documents = Object.values(readLocalClinicalDocumentsStore()[hospitalId] || {});
  return sortDocuments(
    documents
      .filter(document => document.episodeKey === episodeKey)
      .map(document => validateReadRecord(document))
      .filter((document): document is ClinicalDocumentRecord => Boolean(document))
  );
};

const notifyLocalClinicalDocumentSubscribers = (episodeKey: string, hospitalId: string): void => {
  const subscribers = localClinicalDocumentSubscribers.get(`${hospitalId}::${episodeKey}`);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  const documents = listLocalClinicalDocumentsByEpisode(episodeKey, hospitalId);
  subscribers.forEach(callback => callback(documents));
};

const persistLocalClinicalDocument = (
  record: ClinicalDocumentRecord,
  hospitalId: string
): ClinicalDocumentRecord => {
  const store = readLocalClinicalDocumentsStore();
  const hospitalDocuments = store[hospitalId] || {};
  const nextStore = {
    ...store,
    [hospitalId]: {
      ...hospitalDocuments,
      [record.id]: record,
    },
  };
  writeLocalClinicalDocumentsStore(nextStore);
  notifyLocalClinicalDocumentSubscribers(record.episodeKey, hospitalId);
  return record;
};

const deleteLocalClinicalDocument = (documentId: string, hospitalId: string): void => {
  const store = readLocalClinicalDocumentsStore();
  const hospitalDocuments = store[hospitalId] || {};
  const document = hospitalDocuments[documentId];
  if (!document) {
    return;
  }

  const nextHospitalDocuments = { ...hospitalDocuments };
  delete nextHospitalDocuments[documentId];
  writeLocalClinicalDocumentsStore({
    ...store,
    [hospitalId]: nextHospitalDocuments,
  });
  notifyLocalClinicalDocumentSubscribers(document.episodeKey, hospitalId);
};

const enrichRecord = (record: ClinicalDocumentRecord): ClinicalDocumentRecord => {
  const hydrated = parseClinicalDocumentRecord(normalizeClinicalDocumentRecordForStorage(record));
  const renderedText = buildClinicalDocumentRenderedText(hydrated);
  return {
    ...hydrated,
    renderedText,
    integrityHash: buildClinicalDocumentIntegrityHash(hydrated),
  };
};

const validateReadRecord = (record: ClinicalDocumentRecord): ClinicalDocumentRecord | null => {
  const parsed = safeParseClinicalDocumentRecord(hydrateClinicalDocumentRecord(record));
  if (!parsed.success) {
    recordOperationalTelemetry({
      category: 'clinical_document',
      status: 'failed',
      operation: 'clinical_document_repository_invalid_read_record',
      issues: formatClinicalDocumentContractIssues(parsed.error.issues),
      context: { documentId: record.id, documentType: record.documentType },
    });
    return null;
  }

  return parsed.data;
};

const normalizeReadDocuments = (documents: ClinicalDocumentRecord[]): ClinicalDocumentRecord[] =>
  normalizeClinicalDocumentReadRecords(documents, validateReadRecord, sortDocuments);

export const ClinicalDocumentRepository = {
  async listByEpisode(
    episodeKey: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<ClinicalDocumentRecord[]> {
    if (!isFirestoreEnabled()) {
      return listLocalClinicalDocumentsByEpisode(episodeKey, hospitalId);
    }

    const documents = await firestoreDb.getDocs<ClinicalDocumentRecord>(
      getClinicalDocumentsCollectionPath(hospitalId),
      {
        where: [{ field: 'episodeKey', operator: '==', value: episodeKey }],
      }
    );
    return sortDocuments(
      documents
        .map(document => validateReadRecord(document))
        .filter((document): document is ClinicalDocumentRecord => Boolean(document))
    );
  },

  async listByEpisodeKeys(
    episodeKeys: string[],
    hospitalId: string = getActiveHospitalId()
  ): Promise<ClinicalDocumentRecord[]> {
    const sanitizedEpisodeKeys = normalizeEpisodeKeys(episodeKeys);
    if (sanitizedEpisodeKeys.length === 0) {
      return [];
    }
    if (!isFirestoreEnabled()) {
      return sortDocuments(
        sanitizedEpisodeKeys.flatMap(episodeKey =>
          listLocalClinicalDocumentsByEpisode(episodeKey, hospitalId)
        )
      );
    }

    const chunks = chunkArray(sanitizedEpisodeKeys, EPISODE_KEY_QUERY_CHUNK_SIZE);
    const chunkedResults = await Promise.all(
      chunks.map(chunk =>
        firestoreDb.getDocs<ClinicalDocumentRecord>(
          getClinicalDocumentsCollectionPath(hospitalId),
          {
            where: [{ field: 'episodeKey', operator: 'in', value: chunk }],
          }
        )
      )
    );

    return normalizeReadDocuments(chunkedResults.flat());
  },

  async get(
    documentId: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<ClinicalDocumentRecord | null> {
    if (!isFirestoreEnabled()) {
      const document = readLocalClinicalDocumentsStore()[hospitalId]?.[documentId];
      return document ? validateReadRecord(document) : null;
    }

    const document = await firestoreDb.getDoc<ClinicalDocumentRecord>(
      getClinicalDocumentsCollectionPath(hospitalId),
      documentId
    );
    return document ? validateReadRecord(document) : null;
  },

  async createDraft(
    record: ClinicalDocumentRecord,
    hospitalId: string = getActiveHospitalId()
  ): Promise<ClinicalDocumentRecord> {
    const enriched = sanitizeForFirestore(enrichRecord(record));
    if (!isFirestoreEnabled()) {
      return persistLocalClinicalDocument(enriched, hospitalId);
    }

    await firestoreDb.setDoc(getClinicalDocumentsCollectionPath(hospitalId), record.id, enriched);
    return enriched;
  },

  async saveDraft(
    record: ClinicalDocumentRecord,
    hospitalId: string = getActiveHospitalId()
  ): Promise<ClinicalDocumentRecord> {
    const enriched = sanitizeForFirestore(enrichRecord(record));
    if (!isFirestoreEnabled()) {
      return persistLocalClinicalDocument(enriched, hospitalId);
    }

    await firestoreDb.setDoc(getClinicalDocumentsCollectionPath(hospitalId), record.id, enriched, {
      merge: true,
    });
    return enriched;
  },

  async archive(
    documentId: string,
    patch: Pick<ClinicalDocumentRecord, 'status' | 'audit'>,
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    if (!isFirestoreEnabled()) {
      return;
    }

    await firestoreDb.updateDoc(getClinicalDocumentsCollectionPath(hospitalId), documentId, {
      status: patch.status,
      audit: patch.audit,
      isActiveEpisodeDocument: false,
    });
  },

  async savePdfMetadata(
    documentId: string,
    pdf: ClinicalDocumentPdfMeta,
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    if (!isFirestoreEnabled()) {
      return;
    }

    await firestoreDb.updateDoc(getClinicalDocumentsCollectionPath(hospitalId), documentId, {
      pdf: sanitizeForFirestore(pdf),
    });
  },

  /** Locks every unlocked document of the episode (impl in lock-support module). */
  async lockDocumentsByEpisodeKey(
    episodeKey: string,
    hospitalId: string = getActiveHospitalId(),
    options: { lockedAt?: string } = {}
  ): Promise<string[]> {
    return executeLockDocumentsByEpisodeKey(episodeKey, hospitalId, options, {
      isFirestoreEnabled,
      listByEpisode: (key, hospital) => this.listByEpisode(key, hospital),
      applyLockPatchToFirestore: (documentId, patch, hospital) =>
        firestoreDb.updateDoc(getClinicalDocumentsCollectionPath(hospital), documentId, patch),
      applyLockPatchToLocalStore: (record, patch, hospital) => {
        persistLocalClinicalDocument({ ...record, ...patch }, hospital);
      },
    });
  },

  subscribeByEpisode(
    episodeKey: string,
    callback: (documents: ClinicalDocumentRecord[]) => void,
    hospitalId: string = getActiveHospitalId()
  ): () => void {
    if (!isFirestoreEnabled()) {
      const key = `${hospitalId}::${episodeKey}`;
      const subscribers = localClinicalDocumentSubscribers.get(key) || new Set();
      subscribers.add(callback);
      localClinicalDocumentSubscribers.set(key, subscribers);
      callback(listLocalClinicalDocumentsByEpisode(episodeKey, hospitalId));
      return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          localClinicalDocumentSubscribers.delete(key);
        }
      };
    }

    return firestoreDb.subscribeQuery<ClinicalDocumentRecord>(
      getClinicalDocumentsCollectionPath(hospitalId),
      { where: [{ field: 'episodeKey', operator: '==', value: episodeKey }] },
      docs =>
        callback(
          sortDocuments(
            docs
              .map(document => validateReadRecord(document))
              .filter((document): document is ClinicalDocumentRecord => Boolean(document))
          )
        )
    );
  },

  subscribeByEpisodeKeys(
    episodeKeys: string[],
    callback: (documents: ClinicalDocumentRecord[]) => void,
    hospitalId: string = getActiveHospitalId()
  ): () => void {
    return subscribeClinicalDocumentsByEpisodeKeys({
      episodeKeys,
      callback,
      hospitalId,
      firestoreEnabled: isFirestoreEnabled(),
      collectionPath: getClinicalDocumentsCollectionPath(hospitalId),
      chunkSize: EPISODE_KEY_QUERY_CHUNK_SIZE,
      localSubscribers: localClinicalDocumentSubscribers,
      normalizeEpisodeKeys,
      chunkArray,
      listLocalClinicalDocumentsByEpisode,
      normalizeReadDocuments,
      subscribeQuery: firestoreDb.subscribeQuery.bind(firestoreDb),
    });
  },

  async delete(documentId: string, hospitalId: string = getActiveHospitalId()): Promise<void> {
    if (!isFirestoreEnabled()) {
      deleteLocalClinicalDocument(documentId, hospitalId);
      return;
    }

    await firestoreDb.deleteDoc(getClinicalDocumentsCollectionPath(hospitalId), documentId);
  },
};
