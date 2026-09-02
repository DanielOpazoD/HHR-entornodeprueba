import { doc } from 'firebase/firestore';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';
import { reportBasicReadPermissionDenied } from '@/services/auth/sessionPermissionStormDetector';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { withRetry } from '@/utils/networkUtils';
import {
  COLLECTIONS,
  getActiveHospitalId,
  HOSPITAL_COLLECTIONS,
  SETTINGS_DOCS,
} from '@/constants/firestorePaths';
import { firestoreCatalogLogger } from '@/services/storage/storageLoggers';
import { readStringCatalogFromSnapshot } from '@/services/storage/firestore/firestoreShared';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import {
  readFirestoreDocument,
  saveFirestoreDocument,
  subscribeToFirestoreDocument,
} from '@/services/storage/firestore/firestoreDocumentStore';
import {
  normalizeProfessionalCatalog,
  normalizeStringCatalog,
} from '@/services/repositories/contracts/catalogContracts';

const getSettingsDocRef = (docId: string, runtime: Pick<FirestoreServiceRuntimePort, 'getDb'>) =>
  doc(
    runtime.getDb(),
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.SETTINGS,
    docId
  );

const getProfessionalsCatalogDocRef = (runtime: Pick<FirestoreServiceRuntimePort, 'getDb'>) =>
  getSettingsDocRef('professionals_catalog', runtime);

const toSnapshotLike = (catalog: unknown) => ({
  exists: () => Boolean(catalog),
  data: () => (catalog as Record<string, unknown> | undefined) ?? undefined,
});

const saveStringCatalog = async (
  docId: typeof SETTINGS_DOCS.NURSES | typeof SETTINGS_DOCS.TENS,
  key: 'nurses' | 'tens',
  values: string[],
  runtime: FirestoreServiceRuntimePort
): Promise<void> => {
  const normalizedValues = normalizeStringCatalog(values);
  await withRetry(() =>
    saveFirestoreDocument(runtime, activeRuntime => getSettingsDocRef(docId, activeRuntime), {
      list: normalizedValues,
      [key]: normalizedValues,
      lastUpdated: new Date().toISOString(),
    })
  );
};

const subscribeStringCatalog = (
  docId: typeof SETTINGS_DOCS.NURSES | typeof SETTINGS_DOCS.TENS,
  legacyField: 'nurses' | 'tens',
  callback: (values: string[]) => void,
  errorLabel: string,
  runtime: FirestoreServiceRuntimePort
): (() => void) => {
  return subscribeToFirestoreDocument({
    runtime,
    resolveRef: activeRuntime => getSettingsDocRef(docId, activeRuntime),
    onData: catalog => {
      if (!catalog) {
        callback([]);
        return;
      }

      const values = readStringCatalogFromSnapshot(
        {
          exists: () => true,
          data: () => catalog as Record<string, unknown>,
        },
        legacyField
      );
      callback(values);
    },
    onError: error => {
      firestoreCatalogLogger.error(`Error preparing ${errorLabel} subscription`, error);
      if (classifySyncError(error).category === 'authorization')
        reportBasicReadPermissionDenied(`catalog:${errorLabel}`);
      callback([]);
    },
  });
};

const getStringCatalog = async (
  docId: typeof SETTINGS_DOCS.NURSES | typeof SETTINGS_DOCS.TENS,
  legacyField: 'nurses' | 'tens',
  errorLabel: string,
  runtime: FirestoreServiceRuntimePort
): Promise<string[]> => {
  try {
    const catalog: Record<string, unknown> | null = await readFirestoreDocument(
      runtime,
      activeRuntime => getSettingsDocRef(docId, activeRuntime)
    );
    return readStringCatalogFromSnapshot(toSnapshotLike(catalog), legacyField);
  } catch (error) {
    firestoreCatalogLogger.error(`Error fetching ${errorLabel} from Firestore`, error);
    return [];
  }
};

const getProfessionalsCatalog = async (
  runtime: FirestoreServiceRuntimePort
): Promise<ProfessionalCatalogItem[]> => {
  try {
    const catalog: { list?: unknown } | null = await readFirestoreDocument(
      runtime,
      getProfessionalsCatalogDocRef
    );
    if (catalog) {
      return normalizeProfessionalCatalog(catalog.list);
    }
    return [];
  } catch (error) {
    firestoreCatalogLogger.error('Error fetching professionals catalog from Firestore', error);
    return [];
  }
};

const saveProfessionalsCatalog = async (
  professionals: ProfessionalCatalogItem[],
  runtime: FirestoreServiceRuntimePort
): Promise<void> => {
  const normalized = normalizeProfessionalCatalog(professionals);
  await withRetry(() =>
    saveFirestoreDocument(runtime, getProfessionalsCatalogDocRef, {
      list: normalized,
      lastUpdated: new Date().toISOString(),
    })
  );
};

const subscribeToProfessionalsCatalogWithRuntime = (
  callback: (professionals: ProfessionalCatalogItem[]) => void,
  runtime: FirestoreServiceRuntimePort
): (() => void) => {
  return subscribeToFirestoreDocument({
    runtime,
    resolveRef: getProfessionalsCatalogDocRef,
    onData: catalog => {
      callback(catalog ? normalizeProfessionalCatalog((catalog as { list?: unknown }).list) : []);
    },
    onError: error => {
      firestoreCatalogLogger.error('Error preparing professionals catalog subscription', error);
      if (classifySyncError(error).category === 'authorization')
        reportBasicReadPermissionDenied('catalog:professionals');
      callback([]);
    },
  });
};

export const getNurseCatalogFromFirestore = async (): Promise<string[]> =>
  getStringCatalog(SETTINGS_DOCS.NURSES, 'nurses', 'nurse catalog', defaultFirestoreServiceRuntime);

export const saveNurseCatalogToFirestore = async (nurses: string[]): Promise<void> => {
  try {
    await saveStringCatalog(SETTINGS_DOCS.NURSES, 'nurses', nurses, defaultFirestoreServiceRuntime);
  } catch (error) {
    firestoreCatalogLogger.error('Error saving nurse catalog to Firestore', error);
    throw error;
  }
};

export const subscribeToNurseCatalog = (callback: (nurses: string[]) => void): (() => void) =>
  subscribeStringCatalog(
    SETTINGS_DOCS.NURSES,
    'nurses',
    callback,
    'nurse catalog',
    defaultFirestoreServiceRuntime
  );

export const getTensCatalogFromFirestore = async (): Promise<string[]> =>
  getStringCatalog(SETTINGS_DOCS.TENS, 'tens', 'TENS catalog', defaultFirestoreServiceRuntime);

export const saveTensCatalogToFirestore = async (tens: string[]): Promise<void> => {
  try {
    await saveStringCatalog(SETTINGS_DOCS.TENS, 'tens', tens, defaultFirestoreServiceRuntime);
  } catch (error) {
    firestoreCatalogLogger.error('Error saving TENS catalog to Firestore', error);
    throw error;
  }
};

export const subscribeToTensCatalog = (callback: (tens: string[]) => void): (() => void) =>
  subscribeStringCatalog(
    SETTINGS_DOCS.TENS,
    'tens',
    callback,
    'TENS catalog',
    defaultFirestoreServiceRuntime
  );

export const getProfessionalsCatalogFromFirestore = async (): Promise<ProfessionalCatalogItem[]> =>
  getProfessionalsCatalog(defaultFirestoreServiceRuntime);

export const saveProfessionalsCatalogToFirestore = async (
  professionals: ProfessionalCatalogItem[]
): Promise<void> => {
  try {
    await saveProfessionalsCatalog(professionals, defaultFirestoreServiceRuntime);
  } catch (error) {
    firestoreCatalogLogger.error('Error saving professionals catalog to Firestore', error);
    throw error;
  }
};

export const subscribeToProfessionalsCatalog = (
  callback: (professionals: ProfessionalCatalogItem[]) => void
): (() => void) =>
  subscribeToProfessionalsCatalogWithRuntime(callback, defaultFirestoreServiceRuntime);
