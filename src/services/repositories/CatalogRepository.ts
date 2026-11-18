import { CatalogConflictError } from './contracts/catalogChanges';
import {
  getCatalog,
  getCatalogValues,
  cacheCatalogValues,
} from '@/services/storage/indexeddb/indexedDbCatalogService';
import {
  saveNurseCatalogToFirestore,
  saveTensCatalogToFirestore,
  subscribeToNurseCatalog,
  subscribeToTensCatalog,
  getNurseCatalogFromFirestore,
  getTensCatalogFromFirestore,
  getProfessionalsCatalogFromFirestore,
  saveProfessionalsCatalogToFirestore,
  subscribeToProfessionalsCatalog,
} from '../storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import {
  CatalogRemoteSyncError,
  normalizeProfessionalCatalog,
  normalizeStringCatalog,
  assertCatalogSubscriptionCallback,
  NURSE_CATALOG_EXAMPLES,
  TENS_CATALOG_EXAMPLES,
  catalogExamples,
} from '@/services/repositories/contracts/catalogContracts';
import { catalogRepositoryLogger } from '@/services/repositories/repositoryLoggers';
import {
  captureAuthoringSession,
  isAuthoringSessionCurrent,
} from '@/services/storage/authoringSession';

export interface ICatalogRepository {
  getNurses(): Promise<string[]>;
  saveNurses(nurses: string[], base: string[]): Promise<string[] | void>;
  subscribeNurses(
    callback: (nurses: string[]) => void,
    onError?: (error: unknown) => void
  ): () => void;
  getTens(): Promise<string[]>;
  saveTens(tens: string[], base: string[]): Promise<string[] | void>;
  subscribeTens(callback: (tens: string[]) => void, onError?: (error: unknown) => void): () => void;
  getProfessionals(): Promise<ProfessionalCatalogItem[]>;
  saveProfessionals(
    professionals: ProfessionalCatalogItem[],
    base: ProfessionalCatalogItem[]
  ): Promise<ProfessionalCatalogItem[] | void>;
  subscribeProfessionals(
    callback: (professionals: ProfessionalCatalogItem[]) => void,
    onError?: (error: unknown) => void
  ): () => void;
}

// A disabled runtime has no durable resend path for catalogs.
const assertCatalogRemoteAvailable = (): void => {
  if (!isFirestoreEnabled() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    throw new CatalogRemoteSyncError(new Error('Catalog remote unavailable'));
  }
};

// Bounds the complete retry chain; the SDK may still acknowledge the write later.
const confirmCatalogSave = async <T>(save: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      save,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new CatalogRemoteSyncError('confirmation_timeout')),
          15_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

type CatalogId = 'nurses' | 'tens' | 'professionals';

/**
 * The local copy keeps the newest list this document received from the server. Firestore gives the
 * client no version of the document, and its `lastUpdated` comes from each writer's clock, so
 * answers are ordered by when this document asked: the answer to an earlier request (another
 * session's save, a read still in flight) never replaces a list a later request already copied.
 * Nothing in flight outlives the document, so the order needs no storage.
 */
let remoteRequests = 0;
const newestCopiedRequest = new Map<CatalogId, number>();
const startRemoteRequest = (catalogId: CatalogId) => {
  const request = ++remoteRequests;
  return <T>(list: T[]): Promise<void> => {
    if (request < (newestCopiedRequest.get(catalogId) ?? 0)) return Promise.resolve();
    newestCopiedRequest.set(catalogId, request);
    return cacheCatalogValues<T>(catalogId, list, true);
  };
};

/**
 * Keeps the local copy of a remote snapshot, then hands it on only if the session that received
 * it is still current: logout cleared the screen's catalog, and the next person reads their own.
 */
const deliverAfterLocalCopy =
  <T>(catalogId: CatalogId, normalize: (items: T[]) => T[], callback: (items: T[]) => void) =>
  async (items: T[]): Promise<void> => {
    const session = captureAuthoringSession();
    const copy = startRemoteRequest(catalogId);
    const normalized = normalize(items);
    await copy(normalized);
    if (isAuthoringSessionCurrent(session)) callback(normalized);
  };

// ============================================================================
// Nurses Catalog
// ============================================================================

/**
 * Retrieves the list of nurses from local storage.
 * Returns default placeholder values if no nurses have been configured.
 */
export const getNurses = async (): Promise<string[]> => {
  // 1. Try local
  const localList = await getCatalog('nurses');
  if (localList.length > 0) return localList;

  // 2. Try Beta Firestore
  if (isFirestoreEnabled()) {
    try {
      const copy = startRemoteRequest('nurses');
      const remoteList = await getNurseCatalogFromFirestore();
      if (remoteList.length > 0) {
        await copy(remoteList);
        return remoteList;
      }
    } catch (err) {
      catalogRepositoryLogger.warn('Failed to fetch nurses from remote', err);
      throw err;
    }
  }

  return catalogExamples(NURSE_CATALOG_EXAMPLES);
};

/**
 * Confirms the nurses list remotely before refreshing its local cache.
 */
export const saveNurses = async (nurses: string[], base: string[]): Promise<string[] | void> => {
  const normalized = normalizeStringCatalog(nurses);
  assertCatalogRemoteAvailable();
  let accepted: string[];
  const copy = startRemoteRequest('nurses');
  try {
    accepted = await confirmCatalogSave(saveNurseCatalogToFirestore(normalized, base));
  } catch (cause) {
    if (cause instanceof CatalogConflictError) {
      await copy(normalizeStringCatalog(cause.current));
      throw cause;
    }
    throw new CatalogRemoteSyncError(cause);
  }
  await copy(accepted ?? normalized);
  return accepted;
};

const subscribeToLocalStringCatalog = (
  key: 'nurses' | 'tens',
  callback: (items: string[]) => void,
  onError?: (error: unknown) => void
): (() => void) => {
  let isActive = true;
  void getCatalog(key)
    .then(items => {
      if (isActive) {
        callback(normalizeStringCatalog(items));
      }
    })
    .catch(error => {
      if (isActive) onError?.(error);
    });

  return () => {
    isActive = false;
  };
};

const subscribeToLocalProfessionalsCatalog = (
  callback: (professionals: ProfessionalCatalogItem[]) => void,
  onError?: (error: unknown) => void
): (() => void) => {
  let isActive = true;
  void getCatalogValues<ProfessionalCatalogItem>('professionals')
    .then(items => {
      if (isActive) {
        callback(normalizeProfessionalCatalog(items));
      }
    })
    .catch(error => {
      if (isActive) onError?.(error);
    });

  return () => {
    isActive = false;
  };
};

/**
 * Subscribes to real-time updates for the nurses catalog from Firestore.
 */
export const subscribeNurses = (
  callback: (nurses: string[]) => void,
  onError?: (error: unknown) => void
): (() => void) => {
  assertCatalogSubscriptionCallback(callback, 'nurses');
  if (!isFirestoreEnabled()) {
    return subscribeToLocalStringCatalog('nurses', callback, onError);
  }

  return subscribeToNurseCatalog(
    deliverAfterLocalCopy('nurses', normalizeStringCatalog, callback),
    onError
  );
};

// ============================================================================
// TENS Catalog
// ============================================================================

/**
 * Retrieves the list of TENS from local storage.
 */
export const getTens = async (): Promise<string[]> => {
  // 1. Try local
  const localList = await getCatalog('tens');
  if (localList.length > 0) return localList;

  // 2. Try Beta Firestore
  if (isFirestoreEnabled()) {
    try {
      const copy = startRemoteRequest('tens');
      const remoteList = await getTensCatalogFromFirestore();
      if (remoteList.length > 0) {
        await copy(remoteList);
        return remoteList;
      }
    } catch (err) {
      catalogRepositoryLogger.warn('Failed to fetch TENS from remote', err);
      throw err;
    }
  }

  return catalogExamples(TENS_CATALOG_EXAMPLES);
};

/**
 * Confirms the TENS list remotely before refreshing its local cache.
 */
export const saveTens = async (tens: string[], base: string[]): Promise<string[] | void> => {
  const normalized = normalizeStringCatalog(tens);
  assertCatalogRemoteAvailable();
  let accepted: string[];
  const copy = startRemoteRequest('tens');
  try {
    accepted = await confirmCatalogSave(saveTensCatalogToFirestore(normalized, base));
  } catch (cause) {
    if (cause instanceof CatalogConflictError) {
      await copy(normalizeStringCatalog(cause.current));
      throw cause;
    }
    throw new CatalogRemoteSyncError(cause);
  }
  await copy(accepted ?? normalized);
  return accepted;
};

/**
 * Subscribes to real-time updates for the TENS catalog from Firestore.
 */
export const subscribeTens = (
  callback: (tens: string[]) => void,
  onError?: (error: unknown) => void
): (() => void) => {
  assertCatalogSubscriptionCallback(callback, 'tens');
  if (!isFirestoreEnabled()) {
    return subscribeToLocalStringCatalog('tens', callback, onError);
  }

  return subscribeToTensCatalog(
    deliverAfterLocalCopy('tens', normalizeStringCatalog, callback),
    onError
  );
};

// ============================================================================
// Professionals Catalog
// ============================================================================

/**
 * Retrieves the list of professionals from local storage.
 */
export const getProfessionals = async (): Promise<ProfessionalCatalogItem[]> => {
  // 1. Try local
  const localList = await getCatalogValues<ProfessionalCatalogItem>('professionals');
  const parsedList = normalizeProfessionalCatalog(localList);
  if (parsedList.length > 0) return parsedList;

  // 2. Try Beta Firestore
  if (isFirestoreEnabled()) {
    try {
      const copy = startRemoteRequest('professionals');
      const remoteList = await getProfessionalsCatalogFromFirestore();
      if (remoteList.length > 0) {
        await copy(remoteList);
        return remoteList;
      }
    } catch (err) {
      catalogRepositoryLogger.warn('Failed to fetch professionals from remote', err);
      throw err;
    }
  }

  return [];
};

/**
 * Confirms the professionals list remotely before refreshing its local cache.
 */
export const saveProfessionals = async (
  professionals: ProfessionalCatalogItem[],
  base: ProfessionalCatalogItem[]
): Promise<ProfessionalCatalogItem[] | void> => {
  const normalized = normalizeProfessionalCatalog(professionals);
  assertCatalogRemoteAvailable();
  let accepted: ProfessionalCatalogItem[];
  const copy = startRemoteRequest('professionals');
  try {
    accepted = await confirmCatalogSave(saveProfessionalsCatalogToFirestore(normalized, base));
  } catch (cause) {
    if (cause instanceof CatalogConflictError) {
      await copy(normalizeProfessionalCatalog(cause.current));
      throw cause;
    }
    throw new CatalogRemoteSyncError(cause);
  }
  await copy(accepted ?? normalized);
  return accepted;
};

/**
 * Subscribes to real-time updates for the professionals catalog from Firestore.
 */
export const subscribeProfessionals = (
  callback: (professionals: ProfessionalCatalogItem[]) => void,
  onError?: (error: unknown) => void
): (() => void) => {
  assertCatalogSubscriptionCallback(callback, 'professionals');
  if (!isFirestoreEnabled()) {
    return subscribeToLocalProfessionalsCatalog(callback, onError);
  }

  return subscribeToProfessionalsCatalog(
    deliverAfterLocalCopy('professionals', normalizeProfessionalCatalog, callback),
    onError
  );
};

// ============================================================================
// Repository Object Export
// ============================================================================

export const CatalogRepository: ICatalogRepository = {
  getNurses,
  saveNurses,
  subscribeNurses,
  getTens,
  saveTens,
  subscribeTens,
  getProfessionals,
  saveProfessionals,
  subscribeProfessionals,
};
