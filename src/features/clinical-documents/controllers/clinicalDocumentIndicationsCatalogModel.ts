import { normalizeClinicalDocumentIndicationTextKey } from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsController';

export interface ClinicalDocumentIndicationCatalogItem {
  id: string;
  text: string;
  source: 'custom';
  createdAt?: string;
}

export interface ClinicalDocumentIndicationCatalogTab {
  id: string;
  label: string;
  items: ClinicalDocumentIndicationCatalogItem[];
}

export interface ClinicalDocumentIndicationsCatalog {
  version: number;
  uid: string;
  email: string;
  updatedAt: string;
  activeTabId: string;
  tabs: ClinicalDocumentIndicationCatalogTab[];
  /** Compatibility view for callers that only need the active tab's indications. */
  items: ClinicalDocumentIndicationCatalogItem[];
}

export type RawClinicalDocumentIndicationsCatalog =
  | {
      version?: number;
      uid?: unknown;
      email?: unknown;
      updatedAt?: unknown;
      activeTabId?: unknown;
      tabs?: unknown[];
      items?: unknown[];
    }
  | null
  | undefined;

interface ClinicalDocumentIndicationsCatalogOwner {
  uid?: string | null;
  email?: string | null;
}

export const DEFAULT_CLINICAL_DOCUMENT_INDICATIONS_TAB_ID = 'general';
const DEFAULT_TAB_LABEL = 'General';

export const normalizeClinicalDocumentIndicationsText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ');

export const normalizeClinicalDocumentIndicationsTabLabel = (value: string): string =>
  normalizeClinicalDocumentIndicationsText(value).slice(0, 48);

export const buildClinicalDocumentIndicationCatalogItemId = (text: string): string =>
  `custom-${normalizeClinicalDocumentIndicationTextKey(text).replace(/[^a-z0-9]+/g, '-')}`;

export const buildClinicalDocumentIndicationCatalogTabId = (label: string): string => {
  const normalized = normalizeClinicalDocumentIndicationTextKey(label)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_CLINICAL_DOCUMENT_INDICATIONS_TAB_ID;
};

const resolveActiveTab = (
  tabs: ClinicalDocumentIndicationCatalogTab[],
  activeTabId: unknown
): ClinicalDocumentIndicationCatalogTab =>
  tabs.find(tab => tab.id === activeTabId) ||
  tabs[0] ||
  buildDefaultClinicalDocumentIndicationsTab();

export const withClinicalDocumentIndicationsActiveItems = (
  catalog: Omit<ClinicalDocumentIndicationsCatalog, 'items'> & {
    items?: ClinicalDocumentIndicationCatalogItem[];
  }
): ClinicalDocumentIndicationsCatalog => {
  const activeTab = catalog.tabs.find(tab => tab.id === catalog.activeTabId) || catalog.tabs[0];
  return {
    ...catalog,
    activeTabId: activeTab?.id || DEFAULT_CLINICAL_DOCUMENT_INDICATIONS_TAB_ID,
    items: activeTab?.items || [],
  };
};

export const getActiveClinicalDocumentIndicationsTabId = (
  catalog: ClinicalDocumentIndicationsCatalog,
  tabId?: string | null
): string =>
  String(
    tabId ||
      catalog.activeTabId ||
      catalog.tabs[0]?.id ||
      DEFAULT_CLINICAL_DOCUMENT_INDICATIONS_TAB_ID
  ).trim();

export const mapClinicalDocumentIndicationsTabItems = (
  catalog: ClinicalDocumentIndicationsCatalog,
  tabId: string,
  mapItems: (
    items: ClinicalDocumentIndicationCatalogItem[]
  ) => ClinicalDocumentIndicationCatalogItem[]
): ClinicalDocumentIndicationsCatalog =>
  withClinicalDocumentIndicationsActiveItems({
    ...catalog,
    activeTabId: tabId,
    tabs: catalog.tabs.map(tab =>
      tab.id === tabId
        ? {
            ...tab,
            items: mapItems(tab.items),
          }
        : tab
    ),
  });

export const buildUniqueClinicalDocumentIndicationsTabId = (
  tabs: ClinicalDocumentIndicationCatalogTab[],
  label: string
): string => {
  const baseId = buildClinicalDocumentIndicationCatalogTabId(label);
  if (!tabs.some(tab => tab.id === baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (tabs.some(tab => tab.id === `${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}`;
};

export const buildDefaultClinicalDocumentIndicationsTab = (
  items: ClinicalDocumentIndicationCatalogItem[] = []
): ClinicalDocumentIndicationCatalogTab => ({
  id: DEFAULT_CLINICAL_DOCUMENT_INDICATIONS_TAB_ID,
  label: DEFAULT_TAB_LABEL,
  items,
});

export const getDefaultClinicalDocumentIndicationsCatalog = (
  now: string = new Date().toISOString(),
  owner: ClinicalDocumentIndicationsCatalogOwner = {}
): ClinicalDocumentIndicationsCatalog => {
  const tabs = [buildDefaultClinicalDocumentIndicationsTab()];
  return {
    version: 1,
    uid: String(owner.uid || '').trim(),
    email: String(owner.email || '').trim(),
    updatedAt: now,
    activeTabId: DEFAULT_CLINICAL_DOCUMENT_INDICATIONS_TAB_ID,
    tabs,
    items: tabs[0].items,
  };
};

const normalizeItem = (
  rawItem: unknown,
  fallbackIndex: number
): ClinicalDocumentIndicationCatalogItem | null => {
  const text =
    typeof rawItem === 'string'
      ? normalizeClinicalDocumentIndicationsText(rawItem)
      : typeof rawItem === 'object' &&
          rawItem &&
          'text' in rawItem &&
          typeof rawItem.text === 'string'
        ? normalizeClinicalDocumentIndicationsText(rawItem.text)
        : '';

  if (!text) {
    return null;
  }

  const objectItem =
    typeof rawItem === 'object' && rawItem
      ? (rawItem as Partial<ClinicalDocumentIndicationCatalogItem>)
      : null;
  const explicitId = typeof objectItem?.id === 'string' ? objectItem.id.trim() : '';

  return {
    id: explicitId || `${buildClinicalDocumentIndicationCatalogItemId(text)}-${fallbackIndex}`,
    text,
    source: 'custom',
    createdAt: typeof objectItem?.createdAt === 'string' ? objectItem.createdAt : undefined,
  };
};

const normalizeItems = (
  rawItems: unknown[] | undefined
): ClinicalDocumentIndicationCatalogItem[] => {
  const seen = new Set<string>();
  return Array.isArray(rawItems)
    ? rawItems.reduce<ClinicalDocumentIndicationCatalogItem[]>((accumulator, rawItem) => {
        const item = normalizeItem(rawItem, accumulator.length + 1);
        if (!item) {
          return accumulator;
        }

        const textKey = normalizeClinicalDocumentIndicationTextKey(item.text);
        if (seen.has(textKey)) {
          return accumulator;
        }

        seen.add(textKey);
        accumulator.push(item);
        return accumulator;
      }, [])
    : [];
};

const normalizeTab = (
  rawTab: unknown,
  fallbackIndex: number
): ClinicalDocumentIndicationCatalogTab | null => {
  if (!rawTab || typeof rawTab !== 'object') {
    return null;
  }

  const tabRecord = rawTab as {
    id?: unknown;
    label?: unknown;
    items?: unknown[];
  };
  const label = normalizeClinicalDocumentIndicationsTabLabel(String(tabRecord.label || ''));
  if (!label) {
    return null;
  }

  const rawId = typeof tabRecord.id === 'string' ? tabRecord.id.trim() : '';
  return {
    id: rawId || `${buildClinicalDocumentIndicationCatalogTabId(label)}-${fallbackIndex}`,
    label,
    items: normalizeItems(tabRecord.items),
  };
};

const normalizeTabs = (
  rawCatalog: RawClinicalDocumentIndicationsCatalog
): ClinicalDocumentIndicationCatalogTab[] => {
  if (rawCatalog?.tabs && Array.isArray(rawCatalog.tabs)) {
    const tabs = rawCatalog.tabs
      .map((tab, index) => normalizeTab(tab, index + 1))
      .filter((tab): tab is ClinicalDocumentIndicationCatalogTab => Boolean(tab));
    return tabs.length ? tabs : [buildDefaultClinicalDocumentIndicationsTab()];
  }

  return [buildDefaultClinicalDocumentIndicationsTab(normalizeItems(rawCatalog?.items))];
};

export const normalizeClinicalDocumentIndicationsCatalog = (
  rawCatalog: RawClinicalDocumentIndicationsCatalog,
  owner: ClinicalDocumentIndicationsCatalogOwner = {}
): ClinicalDocumentIndicationsCatalog => {
  const fallback = getDefaultClinicalDocumentIndicationsCatalog(undefined, owner);
  if (!rawCatalog || typeof rawCatalog !== 'object') {
    return fallback;
  }

  const tabs = normalizeTabs(rawCatalog);
  const activeTab = resolveActiveTab(tabs, rawCatalog.activeTabId);

  return {
    version: typeof rawCatalog.version === 'number' ? rawCatalog.version : fallback.version,
    uid: String(rawCatalog.uid || owner.uid || '').trim(),
    email: String(rawCatalog.email || owner.email || '').trim(),
    updatedAt:
      typeof rawCatalog.updatedAt === 'string' && rawCatalog.updatedAt.trim()
        ? rawCatalog.updatedAt
        : fallback.updatedAt,
    activeTabId: activeTab.id,
    tabs,
    items: activeTab.items,
  };
};
