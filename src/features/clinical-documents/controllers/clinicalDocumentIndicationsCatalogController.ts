import { normalizeClinicalDocumentIndicationTextKey } from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsController';
import {
  buildClinicalDocumentIndicationCatalogItemId,
  buildUniqueClinicalDocumentIndicationsTabId,
  DEFAULT_CLINICAL_DOCUMENT_INDICATIONS_TAB_ID,
  getActiveClinicalDocumentIndicationsTabId,
  mapClinicalDocumentIndicationsTabItems,
  normalizeClinicalDocumentIndicationsTabLabel,
  normalizeClinicalDocumentIndicationsText,
  withClinicalDocumentIndicationsActiveItems,
  type ClinicalDocumentIndicationsCatalog,
} from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogModel';

export {
  buildClinicalDocumentIndicationCatalogItemId,
  buildClinicalDocumentIndicationCatalogTabId,
  buildDefaultClinicalDocumentIndicationsTab,
  getDefaultClinicalDocumentIndicationsCatalog,
  normalizeClinicalDocumentIndicationsCatalog,
} from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogModel';
export type {
  ClinicalDocumentIndicationCatalogItem,
  ClinicalDocumentIndicationCatalogTab,
  ClinicalDocumentIndicationsCatalog,
  RawClinicalDocumentIndicationsCatalog,
} from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogModel';

export const applyClinicalDocumentIndicationsCreateTab = (
  catalog: ClinicalDocumentIndicationsCatalog,
  label: string
): ClinicalDocumentIndicationsCatalog => {
  const trimmedLabel = normalizeClinicalDocumentIndicationsTabLabel(label);
  if (!trimmedLabel) {
    return catalog;
  }

  const tabId = buildUniqueClinicalDocumentIndicationsTabId(catalog.tabs, trimmedLabel);
  return withClinicalDocumentIndicationsActiveItems({
    ...catalog,
    activeTabId: tabId,
    tabs: [...catalog.tabs, { id: tabId, label: trimmedLabel, items: [] }],
  });
};

export const applyClinicalDocumentIndicationsRenameTab = (
  catalog: ClinicalDocumentIndicationsCatalog,
  tabId: string,
  label: string
): ClinicalDocumentIndicationsCatalog => {
  const trimmedLabel = normalizeClinicalDocumentIndicationsTabLabel(label);
  if (!trimmedLabel) {
    return catalog;
  }

  return withClinicalDocumentIndicationsActiveItems({
    ...catalog,
    tabs: catalog.tabs.map(tab => (tab.id === tabId ? { ...tab, label: trimmedLabel } : tab)),
  });
};

export const applyClinicalDocumentIndicationsDeleteTab = (
  catalog: ClinicalDocumentIndicationsCatalog,
  tabId: string
): ClinicalDocumentIndicationsCatalog => {
  if (catalog.tabs.length <= 1) {
    return catalog;
  }

  const nextTabs = catalog.tabs.filter(tab => tab.id !== tabId);
  const nextActiveTabId =
    catalog.activeTabId === tabId
      ? nextTabs[0]?.id || DEFAULT_CLINICAL_DOCUMENT_INDICATIONS_TAB_ID
      : catalog.activeTabId;
  return withClinicalDocumentIndicationsActiveItems({
    ...catalog,
    activeTabId: nextActiveTabId,
    tabs: nextTabs,
  });
};

export const applyClinicalDocumentIndicationsReorderTab = (
  catalog: ClinicalDocumentIndicationsCatalog,
  tabId: string,
  direction: 'left' | 'right'
): ClinicalDocumentIndicationsCatalog => {
  const currentIndex = catalog.tabs.findIndex(tab => tab.id === tabId);
  const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= catalog.tabs.length) {
    return catalog;
  }

  const nextTabs = [...catalog.tabs];
  const [tab] = nextTabs.splice(currentIndex, 1);
  nextTabs.splice(targetIndex, 0, tab);
  return withClinicalDocumentIndicationsActiveItems({
    ...catalog,
    tabs: nextTabs,
  });
};

export const applyClinicalDocumentIndicationsAddItem = (
  catalog: ClinicalDocumentIndicationsCatalog,
  {
    tabId,
    text,
    now = new Date().toISOString(),
    idSuffix = Math.random().toString(36).slice(2, 8),
  }: {
    tabId?: string | null;
    text: string;
    now?: string;
    idSuffix?: string;
  }
): ClinicalDocumentIndicationsCatalog => {
  const trimmedText = normalizeClinicalDocumentIndicationsText(text);
  if (!trimmedText) {
    return catalog;
  }

  const targetTabId = getActiveClinicalDocumentIndicationsTabId(catalog, tabId);
  const targetTab = catalog.tabs.find(tab => tab.id === targetTabId);
  if (!targetTab) {
    return catalog;
  }

  const textKey = normalizeClinicalDocumentIndicationTextKey(trimmedText);
  if (
    targetTab.items.some(item => normalizeClinicalDocumentIndicationTextKey(item.text) === textKey)
  ) {
    return catalog;
  }

  return mapClinicalDocumentIndicationsTabItems(catalog, targetTabId, items => [
    ...items,
    {
      id: `${buildClinicalDocumentIndicationCatalogItemId(trimmedText)}-${idSuffix}`,
      text: trimmedText,
      source: 'custom',
      createdAt: now,
    },
  ]);
};

export const applyClinicalDocumentIndicationsUpdateItem = (
  catalog: ClinicalDocumentIndicationsCatalog,
  {
    tabId,
    itemId,
    text,
  }: {
    tabId?: string | null;
    itemId: string;
    text: string;
  }
): ClinicalDocumentIndicationsCatalog => {
  const trimmedText = normalizeClinicalDocumentIndicationsText(text);
  if (!trimmedText) {
    return catalog;
  }

  const targetTabId = getActiveClinicalDocumentIndicationsTabId(catalog, tabId);
  const targetTab = catalog.tabs.find(tab => tab.id === targetTabId);
  if (!targetTab) {
    return catalog;
  }

  const textKey = normalizeClinicalDocumentIndicationTextKey(trimmedText);
  if (
    targetTab.items.some(
      item =>
        item.id !== itemId && normalizeClinicalDocumentIndicationTextKey(item.text) === textKey
    )
  ) {
    return catalog;
  }

  return mapClinicalDocumentIndicationsTabItems(catalog, targetTabId, items =>
    items.map(item =>
      item.id === itemId ? { ...item, text: trimmedText, source: 'custom' } : item
    )
  );
};

export const applyClinicalDocumentIndicationsDeleteItem = (
  catalog: ClinicalDocumentIndicationsCatalog,
  {
    tabId,
    itemId,
  }: {
    tabId?: string | null;
    itemId: string;
  }
): ClinicalDocumentIndicationsCatalog =>
  mapClinicalDocumentIndicationsTabItems(
    catalog,
    getActiveClinicalDocumentIndicationsTabId(catalog, tabId),
    items => items.filter(item => item.id !== itemId)
  );
