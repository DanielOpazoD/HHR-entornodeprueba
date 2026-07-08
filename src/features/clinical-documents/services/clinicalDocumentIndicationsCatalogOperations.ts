import {
  applyClinicalDocumentIndicationsAddItem,
  applyClinicalDocumentIndicationsCreateTab,
  applyClinicalDocumentIndicationsDeleteItem,
  applyClinicalDocumentIndicationsDeleteTab,
  applyClinicalDocumentIndicationsRenameTab,
  applyClinicalDocumentIndicationsReorderTab,
  applyClinicalDocumentIndicationsUpdateItem,
  type ClinicalDocumentIndicationsCatalog,
} from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogController';

export interface ClinicalDocumentIndicationsCatalogOwner {
  uid?: string | null;
  email?: string | null;
}

interface ClinicalDocumentIndicationsCatalogOperationDependencies {
  load: (
    owner: ClinicalDocumentIndicationsCatalogOwner
  ) => Promise<ClinicalDocumentIndicationsCatalog>;
  saveCatalog: (
    owner: ClinicalDocumentIndicationsCatalogOwner,
    catalog: ClinicalDocumentIndicationsCatalog
  ) => Promise<ClinicalDocumentIndicationsCatalog>;
}

const saveCatalogIfChanged = async (
  saveCatalog: ClinicalDocumentIndicationsCatalogOperationDependencies['saveCatalog'],
  owner: ClinicalDocumentIndicationsCatalogOwner,
  currentCatalog: ClinicalDocumentIndicationsCatalog,
  nextCatalog: ClinicalDocumentIndicationsCatalog
): Promise<ClinicalDocumentIndicationsCatalog> =>
  nextCatalog === currentCatalog ? currentCatalog : saveCatalog(owner, nextCatalog);

export const createClinicalDocumentIndicationsCatalogOperations = ({
  load,
  saveCatalog,
}: ClinicalDocumentIndicationsCatalogOperationDependencies) => ({
  async createTab({
    uid,
    email,
    label,
  }: ClinicalDocumentIndicationsCatalogOwner & {
    label: string;
  }): Promise<ClinicalDocumentIndicationsCatalog> {
    const currentCatalog = await load({ uid, email });
    return saveCatalogIfChanged(
      saveCatalog,
      { uid, email },
      currentCatalog,
      applyClinicalDocumentIndicationsCreateTab(currentCatalog, label)
    );
  },

  async renameTab({
    uid,
    email,
    tabId,
    label,
  }: ClinicalDocumentIndicationsCatalogOwner & {
    tabId: string;
    label: string;
  }): Promise<ClinicalDocumentIndicationsCatalog> {
    const currentCatalog = await load({ uid, email });
    return saveCatalogIfChanged(
      saveCatalog,
      { uid, email },
      currentCatalog,
      applyClinicalDocumentIndicationsRenameTab(currentCatalog, tabId, label)
    );
  },

  async deleteTab({
    uid,
    email,
    tabId,
  }: ClinicalDocumentIndicationsCatalogOwner & {
    tabId: string;
  }): Promise<ClinicalDocumentIndicationsCatalog> {
    const currentCatalog = await load({ uid, email });
    return saveCatalogIfChanged(
      saveCatalog,
      { uid, email },
      currentCatalog,
      applyClinicalDocumentIndicationsDeleteTab(currentCatalog, tabId)
    );
  },

  async reorderTab({
    uid,
    email,
    tabId,
    direction,
  }: ClinicalDocumentIndicationsCatalogOwner & {
    tabId: string;
    direction: 'left' | 'right';
  }): Promise<ClinicalDocumentIndicationsCatalog> {
    const currentCatalog = await load({ uid, email });
    return saveCatalogIfChanged(
      saveCatalog,
      { uid, email },
      currentCatalog,
      applyClinicalDocumentIndicationsReorderTab(currentCatalog, tabId, direction)
    );
  },

  async addItem({
    uid,
    email,
    tabId,
    text,
  }: ClinicalDocumentIndicationsCatalogOwner & {
    tabId?: string;
    text: string;
  }): Promise<ClinicalDocumentIndicationsCatalog> {
    const currentCatalog = await load({ uid, email });
    return saveCatalogIfChanged(
      saveCatalog,
      { uid, email },
      currentCatalog,
      applyClinicalDocumentIndicationsAddItem(currentCatalog, { tabId, text })
    );
  },

  async updateItem({
    uid,
    email,
    tabId,
    itemId,
    text,
  }: ClinicalDocumentIndicationsCatalogOwner & {
    tabId?: string;
    itemId: string;
    text: string;
  }): Promise<ClinicalDocumentIndicationsCatalog> {
    const currentCatalog = await load({ uid, email });
    return saveCatalogIfChanged(
      saveCatalog,
      { uid, email },
      currentCatalog,
      applyClinicalDocumentIndicationsUpdateItem(currentCatalog, { tabId, itemId, text })
    );
  },

  async deleteItem({
    uid,
    email,
    tabId,
    itemId,
  }: ClinicalDocumentIndicationsCatalogOwner & {
    tabId?: string;
    itemId: string;
  }): Promise<ClinicalDocumentIndicationsCatalog> {
    const currentCatalog = await load({ uid, email });
    return saveCatalogIfChanged(
      saveCatalog,
      { uid, email },
      currentCatalog,
      applyClinicalDocumentIndicationsDeleteItem(currentCatalog, { tabId, itemId })
    );
  },
});
