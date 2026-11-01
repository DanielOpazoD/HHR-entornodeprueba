import {
  saveCatalog,
  getCatalog,
  getCatalogValues,
  saveCatalogValues,
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
  normalizeProfessionalCatalog,
  normalizeStringCatalog,
  assertCatalogSubscriptionCallback,
} from '@/services/repositories/contracts/catalogContracts';
import { catalogRepositoryLogger } from '@/services/repositories/repositoryLoggers';

export interface ICatalogRepository {
  getNurses(): Promise<string[]>;
  saveNurses(nurses: string[]): Promise<void>;
  subscribeNurses(callback: (nurses: string[]) => void): () => void;
  getTens(): Promise<string[]>;
  saveTens(tens: string[]): Promise<void>;
  subscribeTens(callback: (tens: string[]) => void): () => void;
  getProfessionals(): Promise<ProfessionalCatalogItem[]>;
  saveProfessionals(professionals: ProfessionalCatalogItem[]): Promise<void>;
  subscribeProfessionals(callback: (professionals: ProfessionalCatalogItem[]) => void): () => void;
}

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
        await saveCatalog('nurses', remoteList);
        return remoteList;
      }
    } catch (err) {
      catalogRepositoryLogger.warn('Failed to fetch nurses from remote', err);
    }
  }

  return ['Enfermero/a 1', 'Enfermero/a 2'];
};

/**
 * Saves the nurses list to local storage and syncs to Firestore if enabled.
 */
export const saveNurses = async (nurses: string[]): Promise<void> => {
  const normalized = normalizeStringCatalog(nurses);
  await saveCatalog('nurses', normalized);
  if (isFirestoreEnabled()) {
    await saveNurseCatalogToFirestore(normalized);
  }
};

const subscribeToLocalStringCatalog = (
  key: 'nurses' | 'tens',
  callback: (items: string[]) => void
): (() => void) => {
  let isActive = true;
  void getCatalog(key).then(items => {
    if (isActive) {
      callback(normalizeStringCatalog(items));
    }
  });

  return () => {
    isActive = false;
  };
};

const subscribeToLocalProfessionalsCatalog = (
  callback: (professionals: ProfessionalCatalogItem[]) => void
): (() => void) => {
  let isActive = true;
  void getCatalogValues<ProfessionalCatalogItem>('professionals').then(items => {
    if (isActive) {
      callback(normalizeProfessionalCatalog(items));
    }
  });

  return () => {
    isActive = false;
  };
};

/**
 * Subscribes to real-time updates for the nurses catalog from Firestore.
 */
export const subscribeNurses = (callback: (nurses: string[]) => void): (() => void) => {
  assertCatalogSubscriptionCallback(callback, 'nurses');
  if (!isFirestoreEnabled()) {
    return subscribeToLocalStringCatalog('nurses', callback);
  }

  return subscribeToNurseCatalog(async nurses => {
    const normalized = normalizeStringCatalog(nurses);
    await saveCatalog('nurses', normalized);
    callback(normalized);
  });
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
        await saveCatalog('tens', remoteList);
        return remoteList;
      }
    } catch (err) {
      catalogRepositoryLogger.warn('Failed to fetch TENS from remote', err);
    }
  }

  return ['TENS 1', 'TENS 2', 'TENS 3'];
};

/**
 * Saves the TENS list to local storage and syncs to Firestore if enabled.
 */
export const saveTens = async (tens: string[]): Promise<void> => {
  const normalized = normalizeStringCatalog(tens);
  await saveCatalog('tens', normalized);
  if (isFirestoreEnabled()) {
    await saveTensCatalogToFirestore(normalized);
  }
};

/**
 * Subscribes to real-time updates for the TENS catalog from Firestore.
 */
export const subscribeTens = (callback: (tens: string[]) => void): (() => void) => {
  assertCatalogSubscriptionCallback(callback, 'tens');
  if (!isFirestoreEnabled()) {
    return subscribeToLocalStringCatalog('tens', callback);
  }

  return subscribeToTensCatalog(async tens => {
    const normalized = normalizeStringCatalog(tens);
    await saveCatalog('tens', normalized);
    callback(normalized);
  });
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
        await saveCatalogValues<ProfessionalCatalogItem>('professionals', remoteList);
        return remoteList;
      }
    } catch (err) {
      catalogRepositoryLogger.warn('Failed to fetch professionals from remote', err);
    }
  }

  return [];
};

/**
 * Saves the professionals list to local storage and syncs to Firestore if enabled.
 */
export const saveProfessionals = async (
  professionals: ProfessionalCatalogItem[]
): Promise<void> => {
  const normalized = normalizeProfessionalCatalog(professionals);
  await saveCatalogValues<ProfessionalCatalogItem>('professionals', normalized);
  if (isFirestoreEnabled()) {
    await saveProfessionalsCatalogToFirestore(normalized);
  }
};

/**
 * Subscribes to real-time updates for the professionals catalog from Firestore.
 */
export const subscribeProfessionals = (
  callback: (professionals: ProfessionalCatalogItem[]) => void
): (() => void) => {
  assertCatalogSubscriptionCallback(callback, 'professionals');
  if (!isFirestoreEnabled()) {
    return subscribeToLocalProfessionalsCatalog(callback);
  }

  return subscribeToProfessionalsCatalog(async professionals => {
    const normalized = normalizeProfessionalCatalog(professionals);
    await saveCatalogValues<ProfessionalCatalogItem>('professionals', normalized);
    callback(normalized);
  });
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
