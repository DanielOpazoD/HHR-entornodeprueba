import { firestoreDb, type IDatabaseProvider } from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  getDefaultClinicalDocumentIndicationsCatalog,
  normalizeClinicalDocumentIndicationsCatalog,
  type ClinicalDocumentIndicationsCatalog,
  type RawClinicalDocumentIndicationsCatalog,
} from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogController';
import {
  createClinicalDocumentIndicationsCatalogOperations,
  type ClinicalDocumentIndicationsCatalogOwner,
} from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogOperations';

export type {
  ClinicalDocumentIndicationCatalogItem,
  ClinicalDocumentIndicationCatalogTab,
  ClinicalDocumentIndicationsCatalog,
  RawClinicalDocumentIndicationsCatalog,
} from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogController';
export {
  getDefaultClinicalDocumentIndicationsCatalog,
  normalizeClinicalDocumentIndicationsCatalog,
} from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogController';

interface UserSettingsDocument {
  clinicalDocumentIndicationsProfile?: RawClinicalDocumentIndicationsCatalog;
}

const USER_SETTINGS_COLLECTION = 'userSettings';
const LOCAL_INDICATIONS_PROFILE_STORAGE_KEY = 'hhr_clinical_document_indications_profiles_v1';

const normalizeOwner = (owner: ClinicalDocumentIndicationsCatalogOwner) => ({
  uid: String(owner.uid || '').trim(),
  email: String(owner.email || '').trim(),
});

const readLocalProfiles = (): Record<string, ClinicalDocumentIndicationsCatalog> => {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_INDICATIONS_PROFILE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ClinicalDocumentIndicationsCatalog>) : {};
  } catch {
    return {};
  }
};

const writeLocalProfile = (profile: ClinicalDocumentIndicationsCatalog): void => {
  try {
    const profiles = readLocalProfiles();
    globalThis.localStorage?.setItem(
      LOCAL_INDICATIONS_PROFILE_STORAGE_KEY,
      JSON.stringify({ ...profiles, [profile.uid]: profile })
    );
  } catch {
    // Local-only mode should never block clinical document editing.
  }
};

const assertOwnerUid = (owner: ClinicalDocumentIndicationsCatalogOwner): string => {
  const { uid } = normalizeOwner(owner);
  if (!uid) {
    throw new Error('No se pudo identificar la cuenta para guardar indicaciones.');
  }
  return uid;
};

const withActiveItems = (
  catalog: Omit<ClinicalDocumentIndicationsCatalog, 'items'> & {
    items?: ClinicalDocumentIndicationsCatalog['items'];
  }
): ClinicalDocumentIndicationsCatalog => {
  const activeTab = catalog.tabs.find(tab => tab.id === catalog.activeTabId) || catalog.tabs[0];
  return {
    ...catalog,
    activeTabId: activeTab?.id || 'general',
    items: activeTab?.items || [],
  };
};

const saveReadyCatalog = (
  owner: ClinicalDocumentIndicationsCatalogOwner,
  catalog: ClinicalDocumentIndicationsCatalog
): ClinicalDocumentIndicationsCatalog => {
  const normalizedOwner = normalizeOwner(owner);
  return withActiveItems({
    ...catalog,
    uid: normalizedOwner.uid,
    email: normalizedOwner.email,
    updatedAt: new Date().toISOString(),
  });
};

export const createClinicalDocumentIndicationsCatalogService = (
  repository: Pick<IDatabaseProvider, 'getDoc' | 'setDoc' | 'subscribeDoc'> = firestoreDb
) => {
  const persistence = {
    async load(
      owner: ClinicalDocumentIndicationsCatalogOwner
    ): Promise<ClinicalDocumentIndicationsCatalog> {
      const normalizedOwner = normalizeOwner(owner);
      if (!normalizedOwner.uid) {
        return getDefaultClinicalDocumentIndicationsCatalog(undefined, normalizedOwner);
      }

      if (!isFirestoreEnabled()) {
        return (
          readLocalProfiles()[normalizedOwner.uid] ||
          getDefaultClinicalDocumentIndicationsCatalog(undefined, normalizedOwner)
        );
      }

      const settings = await repository.getDoc<UserSettingsDocument>(
        USER_SETTINGS_COLLECTION,
        normalizedOwner.uid
      );
      return normalizeClinicalDocumentIndicationsCatalog(
        settings?.clinicalDocumentIndicationsProfile,
        normalizedOwner
      );
    },

    subscribe(
      callback: (catalog: ClinicalDocumentIndicationsCatalog) => void,
      owner: ClinicalDocumentIndicationsCatalogOwner
    ): () => void {
      const normalizedOwner = normalizeOwner(owner);
      if (!normalizedOwner.uid) {
        callback(getDefaultClinicalDocumentIndicationsCatalog(undefined, normalizedOwner));
        return () => {};
      }

      if (!isFirestoreEnabled()) {
        callback(
          readLocalProfiles()[normalizedOwner.uid] ||
            getDefaultClinicalDocumentIndicationsCatalog(undefined, normalizedOwner)
        );
        return () => {};
      }

      return repository.subscribeDoc<UserSettingsDocument>(
        USER_SETTINGS_COLLECTION,
        normalizedOwner.uid,
        settings => {
          callback(
            normalizeClinicalDocumentIndicationsCatalog(
              settings?.clinicalDocumentIndicationsProfile,
              normalizedOwner
            )
          );
        }
      );
    },

    async saveCatalog(
      owner: ClinicalDocumentIndicationsCatalogOwner,
      catalog: ClinicalDocumentIndicationsCatalog
    ): Promise<ClinicalDocumentIndicationsCatalog> {
      const normalizedOwner = normalizeOwner(owner);
      assertOwnerUid(normalizedOwner);
      const nextCatalog = saveReadyCatalog(
        normalizedOwner,
        normalizeClinicalDocumentIndicationsCatalog(catalog, normalizedOwner)
      );

      if (!isFirestoreEnabled()) {
        writeLocalProfile(nextCatalog);
        return nextCatalog;
      }

      await repository.setDoc<UserSettingsDocument>(
        USER_SETTINGS_COLLECTION,
        normalizedOwner.uid,
        { clinicalDocumentIndicationsProfile: nextCatalog },
        { merge: true }
      );
      return nextCatalog;
    },
  };

  return {
    ...persistence,
    ...createClinicalDocumentIndicationsCatalogOperations(persistence),

    async replaceCatalog({
      uid,
      email,
      catalog,
    }: ClinicalDocumentIndicationsCatalogOwner & {
      catalog: RawClinicalDocumentIndicationsCatalog;
    }): Promise<ClinicalDocumentIndicationsCatalog> {
      const normalizedOwner = normalizeOwner({ uid, email });
      return persistence.saveCatalog(
        normalizedOwner,
        normalizeClinicalDocumentIndicationsCatalog(catalog, normalizedOwner)
      );
    },
  };
};

const defaultClinicalDocumentIndicationsCatalogService =
  createClinicalDocumentIndicationsCatalogService();

export const loadClinicalDocumentIndicationsCatalog = async (
  owner: ClinicalDocumentIndicationsCatalogOwner
): Promise<ClinicalDocumentIndicationsCatalog> =>
  defaultClinicalDocumentIndicationsCatalogService.load(owner);

export const subscribeToClinicalDocumentIndicationsCatalog = (
  callback: (catalog: ClinicalDocumentIndicationsCatalog) => void,
  owner: ClinicalDocumentIndicationsCatalogOwner
): (() => void) => defaultClinicalDocumentIndicationsCatalogService.subscribe(callback, owner);

export const createClinicalDocumentIndicationsCatalogTab = async ({
  uid,
  email,
  label,
}: ClinicalDocumentIndicationsCatalogOwner & {
  label: string;
}): Promise<ClinicalDocumentIndicationsCatalog> =>
  defaultClinicalDocumentIndicationsCatalogService.createTab({ uid, email, label });

export const renameClinicalDocumentIndicationsCatalogTab = async ({
  uid,
  email,
  tabId,
  label,
}: ClinicalDocumentIndicationsCatalogOwner & {
  tabId: string;
  label: string;
}): Promise<ClinicalDocumentIndicationsCatalog> =>
  defaultClinicalDocumentIndicationsCatalogService.renameTab({ uid, email, tabId, label });

export const deleteClinicalDocumentIndicationsCatalogTab = async ({
  uid,
  email,
  tabId,
}: ClinicalDocumentIndicationsCatalogOwner & {
  tabId: string;
}): Promise<ClinicalDocumentIndicationsCatalog> =>
  defaultClinicalDocumentIndicationsCatalogService.deleteTab({ uid, email, tabId });

export const reorderClinicalDocumentIndicationsCatalogTab = async ({
  uid,
  email,
  tabId,
  direction,
}: ClinicalDocumentIndicationsCatalogOwner & {
  tabId: string;
  direction: 'left' | 'right';
}): Promise<ClinicalDocumentIndicationsCatalog> =>
  defaultClinicalDocumentIndicationsCatalogService.reorderTab({ uid, email, tabId, direction });

export const addClinicalDocumentIndicationCatalogItem = async ({
  uid,
  email,
  tabId,
  text,
}: ClinicalDocumentIndicationsCatalogOwner & {
  tabId?: string;
  text: string;
}): Promise<ClinicalDocumentIndicationsCatalog> =>
  defaultClinicalDocumentIndicationsCatalogService.addItem({ uid, email, tabId, text });

export const updateClinicalDocumentIndicationCatalogItem = async ({
  uid,
  email,
  tabId,
  itemId,
  text,
}: ClinicalDocumentIndicationsCatalogOwner & {
  tabId?: string;
  itemId: string;
  text: string;
}): Promise<ClinicalDocumentIndicationsCatalog> =>
  defaultClinicalDocumentIndicationsCatalogService.updateItem({
    uid,
    email,
    tabId,
    itemId,
    text,
  });

export const deleteClinicalDocumentIndicationCatalogItem = async ({
  uid,
  email,
  tabId,
  itemId,
}: ClinicalDocumentIndicationsCatalogOwner & {
  tabId?: string;
  itemId: string;
}): Promise<ClinicalDocumentIndicationsCatalog> =>
  defaultClinicalDocumentIndicationsCatalogService.deleteItem({ uid, email, tabId, itemId });

export const replaceClinicalDocumentIndicationsCatalog = async ({
  uid,
  email,
  catalog,
}: ClinicalDocumentIndicationsCatalogOwner & {
  catalog: RawClinicalDocumentIndicationsCatalog;
}): Promise<ClinicalDocumentIndicationsCatalog> =>
  defaultClinicalDocumentIndicationsCatalogService.replaceCatalog({ uid, email, catalog });
