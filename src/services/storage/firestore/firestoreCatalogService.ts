import { preferredStaffName, nurseIdentityKey } from '@/services/staff/nurseIdentity';
import { doc, runTransaction } from 'firebase/firestore';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';
import { reportBasicReadPermissionDenied } from '@/services/auth/sessionPermissionStormDetector';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { ensureFirestoreRuntimeReady } from './firestoreRuntimeSupport';
import {
  applyCatalogChanges,
  diffCatalog,
  exactStaffName,
  professionalCatalogIdentity,
} from '@/services/repositories/contracts/catalogChanges';
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
  base: string[],
  runtime: FirestoreServiceRuntimePort
): Promise<string[]> => {
  await ensureFirestoreRuntimeReady(runtime);
  const ref = getSettingsDocRef(docId, runtime);
  return runTransaction(runtime.getDb(), async transaction => {
    const snapshot = await transaction.get(ref);
    const current = normalizeStringCatalog(readStringCatalogFromSnapshot(snapshot, key));
    const changes = diffCatalog(
      normalizeStringCatalog(base),
      normalizeStringCatalog(values),
      exactStaffName
    );
    let merged = applyCatalogChanges(current, changes, exactStaffName);
    // Admit edits by exact text first; choose spelling only for names being written.
    for (const change of changes) {
      if (change.kind === 'remove') continue;
      const variants = merged.filter(
        name => nurseIdentityKey(name) === nurseIdentityKey(change.after)
      );
      const previous = current.find(
        name => nurseIdentityKey(name) === nurseIdentityKey(change.after)
      );
      // Someone respelling a row by hand means exactly that text: the preference only settles
      // variants that arrive as another row, never a deliberate correction of the same one.
      const respelled =
        change.kind === 'edit' &&
        nurseIdentityKey(change.before) === nurseIdentityKey(change.after);
      const preferred = respelled
        ? change.after
        : variants.reduce(preferredStaffName, previous ?? change.after);
      const first = variants[0];
      const texts = new Set(variants);
      merged = merged.flatMap(name =>
        name === first ? [preferred] : texts.has(name) ? [] : [name]
      );
    }
    transaction.set(ref, { list: merged, [key]: merged, lastUpdated: new Date().toISOString() });
    return merged;
  });
};

const subscribeStringCatalog = (
  docId: typeof SETTINGS_DOCS.NURSES | typeof SETTINGS_DOCS.TENS,
  legacyField: 'nurses' | 'tens',
  callback: (values: string[]) => void,
  errorLabel: string,
  runtime: FirestoreServiceRuntimePort,
  onError?: (error: unknown) => void
): (() => void) => {
  return subscribeToFirestoreDocument({
    runtime,
    confirmedChangesOnly: true,
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
        reportBasicReadPermissionDenied(`catalog:${errorLabel}`, { error });
      onError?.(error);
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
    throw error;
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
    throw error;
  }
};

const saveProfessionalsCatalog = async (
  professionals: ProfessionalCatalogItem[],
  base: ProfessionalCatalogItem[],
  runtime: FirestoreServiceRuntimePort
): Promise<ProfessionalCatalogItem[]> => {
  const changes = diffCatalog(
    normalizeProfessionalCatalog(base),
    normalizeProfessionalCatalog(professionals),
    professionalCatalogIdentity
  );
  await ensureFirestoreRuntimeReady(runtime);
  const ref = getProfessionalsCatalogDocRef(runtime);
  return runTransaction(runtime.getDb(), async transaction => {
    const snapshot = await transaction.get(ref);
    const current = normalizeProfessionalCatalog(snapshot.data()?.list);
    const merged = applyCatalogChanges(current, changes, professionalCatalogIdentity);
    transaction.set(ref, { list: merged, lastUpdated: new Date().toISOString() });
    return merged;
  });
};

const subscribeToProfessionalsCatalogWithRuntime = (
  callback: (professionals: ProfessionalCatalogItem[]) => void,
  runtime: FirestoreServiceRuntimePort,
  onError?: (error: unknown) => void
): (() => void) => {
  return subscribeToFirestoreDocument({
    runtime,
    confirmedChangesOnly: true,
    resolveRef: getProfessionalsCatalogDocRef,
    onData: catalog => {
      callback(catalog ? normalizeProfessionalCatalog((catalog as { list?: unknown }).list) : []);
    },
    onError: error => {
      firestoreCatalogLogger.error('Error preparing professionals catalog subscription', error);
      if (classifySyncError(error).category === 'authorization')
        reportBasicReadPermissionDenied('catalog:professionals', { error });
      onError?.(error);
    },
  });
};

export const getNurseCatalogFromFirestore = async (): Promise<string[]> =>
  getStringCatalog(SETTINGS_DOCS.NURSES, 'nurses', 'nurse catalog', defaultFirestoreServiceRuntime);

export const saveNurseCatalogToFirestore = async (
  nurses: string[],
  base: string[]
): Promise<string[]> => {
  try {
    return await saveStringCatalog(
      SETTINGS_DOCS.NURSES,
      'nurses',
      nurses,
      base,
      defaultFirestoreServiceRuntime
    );
  } catch (error) {
    firestoreCatalogLogger.error('Error saving nurse catalog to Firestore', error);
    throw error;
  }
};

export const subscribeToNurseCatalog = (
  callback: (nurses: string[]) => void,
  onError?: (error: unknown) => void
): (() => void) =>
  subscribeStringCatalog(
    SETTINGS_DOCS.NURSES,
    'nurses',
    callback,
    'nurse catalog',
    defaultFirestoreServiceRuntime,
    onError
  );

export const getTensCatalogFromFirestore = async (): Promise<string[]> =>
  getStringCatalog(SETTINGS_DOCS.TENS, 'tens', 'TENS catalog', defaultFirestoreServiceRuntime);

export const saveTensCatalogToFirestore = async (
  tens: string[],
  base: string[]
): Promise<string[]> => {
  try {
    return await saveStringCatalog(
      SETTINGS_DOCS.TENS,
      'tens',
      tens,
      base,
      defaultFirestoreServiceRuntime
    );
  } catch (error) {
    firestoreCatalogLogger.error('Error saving TENS catalog to Firestore', error);
    throw error;
  }
};

export const subscribeToTensCatalog = (
  callback: (tens: string[]) => void,
  onError?: (error: unknown) => void
): (() => void) =>
  subscribeStringCatalog(
    SETTINGS_DOCS.TENS,
    'tens',
    callback,
    'TENS catalog',
    defaultFirestoreServiceRuntime,
    onError
  );

export const getProfessionalsCatalogFromFirestore = async (): Promise<ProfessionalCatalogItem[]> =>
  getProfessionalsCatalog(defaultFirestoreServiceRuntime);

export const saveProfessionalsCatalogToFirestore = async (
  professionals: ProfessionalCatalogItem[],
  base: ProfessionalCatalogItem[]
): Promise<ProfessionalCatalogItem[]> => {
  try {
    return await saveProfessionalsCatalog(professionals, base, defaultFirestoreServiceRuntime);
  } catch (error) {
    firestoreCatalogLogger.error('Error saving professionals catalog to Firestore', error);
    throw error;
  }
};

export const subscribeToProfessionalsCatalog = (
  callback: (professionals: ProfessionalCatalogItem[]) => void,
  onError?: (error: unknown) => void
): (() => void) =>
  subscribeToProfessionalsCatalogWithRuntime(callback, defaultFirestoreServiceRuntime, onError);
