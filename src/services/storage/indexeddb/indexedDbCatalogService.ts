import { ensureDbReady, hospitalDB as db } from './indexedDbCore';

export const getCatalog = async (catalogId: string): Promise<string[]> => {
  try {
    await ensureDbReady();
    const catalog = await db.catalogs.get(catalogId);
    return catalog?.list || [];
  } catch (error) {
    console.error(`Failed to get catalog ${catalogId}:`, error);
    return [];
  }
};

export const saveCatalog = async (catalogId: string, list: string[]): Promise<void> => {
  try {
    await ensureDbReady();
    await db.catalogs.put({
      id: catalogId,
      list,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Failed to save catalog ${catalogId}:`, error);
  }
};

export const clearCatalog = async (catalogId: string): Promise<void> => {
  try {
    await ensureDbReady();
    await db.catalogs.delete(catalogId);
  } catch (error) {
    console.error(`Failed to clear catalog ${catalogId}:`, error);
  }
};
