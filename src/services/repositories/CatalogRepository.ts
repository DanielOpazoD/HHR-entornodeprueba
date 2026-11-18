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

/** Where one staff catalog lives; every catalog follows the same read, save and live rules. */
interface StaffCatalogStore<T> {
  key: 'nurses' | 'tens' | 'professionals';
  /** Name in log lines. */
  label: string;
  normalize: (value: unknown) => T[];
  /** The local copy as stored. */
  readLocal: () => Promise<T[]>;
  /** What a read answers from the stored local copy; an empty answer goes to the remote one. */
  answerFromLocal: (stored: T[]) => T[];
  /** What a read that found nothing saved returns. */
  whenEmpty: () => T[];
  getRemote: () => Promise<T[]>;
  saveRemote: (items: T[], base: T[]) => Promise<T[]>;
  subscribeRemote: (
    callback: (items: T[]) => void,
    onError?: (error: unknown) => void
  ) => () => void;
}

const nurseStore: StaffCatalogStore<string> = {
  key: 'nurses',
  label: 'nurses',
  normalize: normalizeStringCatalog,
  readLocal: () => getCatalog('nurses'),
  answerFromLocal: stored => stored,
  whenEmpty: () => catalogExamples(NURSE_CATALOG_EXAMPLES),
  getRemote: () => getNurseCatalogFromFirestore(),
  saveRemote: (items, base) => saveNurseCatalogToFirestore(items, base),
  subscribeRemote: (callback, onError) => subscribeToNurseCatalog(callback, onError),
};

const tensStore: StaffCatalogStore<string> = {
  key: 'tens',
  label: 'TENS',
  normalize: normalizeStringCatalog,
  readLocal: () => getCatalog('tens'),
  answerFromLocal: stored => stored,
  whenEmpty: () => catalogExamples(TENS_CATALOG_EXAMPLES),
  getRemote: () => getTensCatalogFromFirestore(),
  saveRemote: (items, base) => saveTensCatalogToFirestore(items, base),
  subscribeRemote: (callback, onError) => subscribeToTensCatalog(callback, onError),
};

const professionalStore: StaffCatalogStore<ProfessionalCatalogItem> = {
  key: 'professionals',
  label: 'professionals',
  normalize: normalizeProfessionalCatalog,
  readLocal: () => getCatalogValues<ProfessionalCatalogItem>('professionals'),
  answerFromLocal: normalizeProfessionalCatalog,
  whenEmpty: () => [],
  getRemote: () => getProfessionalsCatalogFromFirestore(),
  saveRemote: (items, base) => saveProfessionalsCatalogToFirestore(items, base),
  subscribeRemote: (callback, onError) => subscribeToProfessionalsCatalog(callback, onError),
};

/** Local copy first, then the remote one; a failed remote read is an error, never an empty list. */
const readCatalog = async <T>(store: StaffCatalogStore<T>): Promise<T[]> => {
  const localList = store.answerFromLocal(await store.readLocal());
  if (localList.length > 0) return localList;

  if (isFirestoreEnabled()) {
    try {
      const remoteList = await store.getRemote();
      if (remoteList.length > 0) {
        await cacheCatalogValues<T>(store.key, remoteList, true);
        return remoteList;
      }
    } catch (err) {
      catalogRepositoryLogger.warn(`Failed to fetch ${store.label} from remote`, err);
      throw err;
    }
  }

  return store.whenEmpty();
};

/** Confirms the list remotely before refreshing its local copy; a conflict keeps the server list. */
const saveCatalog = async <T>(
  store: StaffCatalogStore<T>,
  items: T[],
  base: T[]
): Promise<T[] | void> => {
  const normalized = store.normalize(items);
  assertCatalogRemoteAvailable();
  let accepted: T[];
  try {
    accepted = await confirmCatalogSave(store.saveRemote(normalized, base));
  } catch (cause) {
    if (cause instanceof CatalogConflictError) {
      await cacheCatalogValues(store.key, store.normalize(cause.current), true);
      throw cause;
    }
    throw new CatalogRemoteSyncError(cause);
  }
  await cacheCatalogValues(store.key, accepted ?? normalized, true);
  return accepted;
};

/** Live remote updates, or a single read of the local copy while sync is off. */
const subscribeCatalog = <T>(
  store: StaffCatalogStore<T>,
  callback: (items: T[]) => void,
  onError?: (error: unknown) => void
): (() => void) => {
  assertCatalogSubscriptionCallback(callback, store.key);
  if (!isFirestoreEnabled()) {
    let isActive = true;
    void store
      .readLocal()
      .then(items => {
        if (isActive) callback(store.normalize(items));
      })
      .catch(error => {
        if (isActive) onError?.(error);
      });
    return () => {
      isActive = false;
    };
  }

  return store.subscribeRemote(async items => {
    const normalized = store.normalize(items);
    await cacheCatalogValues<T>(store.key, normalized, true);
    callback(normalized);
  }, onError);
};

export const getNurses = (): Promise<string[]> => readCatalog(nurseStore);
export const saveNurses = (nurses: string[], base: string[]): Promise<string[] | void> =>
  saveCatalog(nurseStore, nurses, base);
export const subscribeNurses = (
  callback: (nurses: string[]) => void,
  onError?: (error: unknown) => void
): (() => void) => subscribeCatalog(nurseStore, callback, onError);

export const getTens = (): Promise<string[]> => readCatalog(tensStore);
export const saveTens = (tens: string[], base: string[]): Promise<string[] | void> =>
  saveCatalog(tensStore, tens, base);
export const subscribeTens = (
  callback: (tens: string[]) => void,
  onError?: (error: unknown) => void
): (() => void) => subscribeCatalog(tensStore, callback, onError);

export const getProfessionals = (): Promise<ProfessionalCatalogItem[]> =>
  readCatalog(professionalStore);
export const saveProfessionals = (
  professionals: ProfessionalCatalogItem[],
  base: ProfessionalCatalogItem[]
): Promise<ProfessionalCatalogItem[] | void> => saveCatalog(professionalStore, professionals, base);
export const subscribeProfessionals = (
  callback: (professionals: ProfessionalCatalogItem[]) => void,
  onError?: (error: unknown) => void
): (() => void) => subscribeCatalog(professionalStore, callback, onError);

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
