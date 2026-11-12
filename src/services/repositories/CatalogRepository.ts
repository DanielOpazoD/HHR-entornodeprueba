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
} from '@/services/repositories/contracts/catalogContracts';
import { catalogRepositoryLogger } from '@/services/repositories/repositoryLoggers';

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
      const remoteList = await getNurseCatalogFromFirestore();
      if (remoteList.length > 0) {
        await cacheCatalogValues('nurses', remoteList, true);
        return remoteList;
      }
    } catch (err) {
      catalogRepositoryLogger.warn('Failed to fetch nurses from remote', err);
      throw err;
    }
  }

  return [...NURSE_CATALOG_EXAMPLES];
};

/**
 * Confirms the nurses list remotely before refreshing its local cache.
 */
export const saveNurses = async (nurses: string[], base: string[]): Promise<string[] | void> => {
  const normalized = normalizeStringCatalog(nurses);
  assertCatalogRemoteAvailable();
  let accepted: string[];
  try {
    accepted = await confirmCatalogSave(saveNurseCatalogToFirestore(normalized, base));
  } catch (cause) {
    if (cause instanceof CatalogConflictError) {
      await cacheCatalogValues('nurses', normalizeStringCatalog(cause.current), true);
      throw cause;
    }
    throw new CatalogRemoteSyncError(cause);
  }
  await cacheCatalogValues('nurses', accepted ?? normalized, true);
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

  return subscribeToNurseCatalog(async nurses => {
    const normalized = normalizeStringCatalog(nurses);
    await cacheCatalogValues('nurses', normalized, true);
    callback(normalized);
  }, onError);
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
      const remoteList = await getTensCatalogFromFirestore();
      if (remoteList.length > 0) {
        await cacheCatalogValues('tens', remoteList, true);
        return remoteList;
      }
    } catch (err) {
      catalogRepositoryLogger.warn('Failed to fetch TENS from remote', err);
      throw err;
    }
  }

  return [...TENS_CATALOG_EXAMPLES];
};

/**
 * Confirms the TENS list remotely before refreshing its local cache.
 */
export const saveTens = async (tens: string[], base: string[]): Promise<string[] | void> => {
  const normalized = normalizeStringCatalog(tens);
  assertCatalogRemoteAvailable();
  let accepted: string[];
  try {
    accepted = await confirmCatalogSave(saveTensCatalogToFirestore(normalized, base));
  } catch (cause) {
    if (cause instanceof CatalogConflictError) {
      await cacheCatalogValues('tens', normalizeStringCatalog(cause.current), true);
      throw cause;
    }
    throw new CatalogRemoteSyncError(cause);
  }
  await cacheCatalogValues('tens', accepted ?? normalized, true);
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

  return subscribeToTensCatalog(async tens => {
    const normalized = normalizeStringCatalog(tens);
    await cacheCatalogValues('tens', normalized, true);
    callback(normalized);
  }, onError);
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
      const remoteList = await getProfessionalsCatalogFromFirestore();
      if (remoteList.length > 0) {
        await cacheCatalogValues<ProfessionalCatalogItem>('professionals', remoteList, true);
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
  try {
    accepted = await confirmCatalogSave(saveProfessionalsCatalogToFirestore(normalized, base));
  } catch (cause) {
    if (cause instanceof CatalogConflictError) {
      await cacheCatalogValues('professionals', normalizeProfessionalCatalog(cause.current), true);
      throw cause;
    }
    throw new CatalogRemoteSyncError(cause);
  }
  await cacheCatalogValues('professionals', accepted ?? normalized, true);
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

  return subscribeToProfessionalsCatalog(async professionals => {
    const normalized = normalizeProfessionalCatalog(professionals);
    await cacheCatalogValues<ProfessionalCatalogItem>('professionals', normalized, true);
    callback(normalized);
  }, onError);
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
