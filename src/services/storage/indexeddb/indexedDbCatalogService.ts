import { ensureDbReady, hospitalDB as db } from './indexedDbCore';
import { CatalogRecord } from './indexedDbCatalogContracts';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';

export const getCatalogValues = async <T = string>(catalogId: string): Promise<T[]> => {
  try {
    await ensureDbReady();
    const catalog = (await db.catalogs.get(catalogId)) as CatalogRecord<T> | undefined;
    return catalog?.list || [];
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_catalog', error, {
      code: 'indexeddb_get_catalog_failed',
      message: `No fue posible recuperar el catalogo ${catalogId}.`,
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar un catalogo local.',
      context: { catalogId },
    });
    throw error;
  }
};

export const saveCatalogValues = async <T = string>(
  catalogId: string,
  list: T[]
): Promise<void> => {
  try {
    await ensureDbReady();
    const payload: CatalogRecord<T> = {
      id: catalogId,
      list,
      lastUpdated: new Date().toISOString(),
    };
    await db.catalogs.put(payload);
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_save_catalog', error, {
      code: 'indexeddb_save_catalog_failed',
      message: `No fue posible guardar el catalogo ${catalogId}.`,
      severity: 'warning',
      userSafeMessage: 'No fue posible guardar un catalogo local.',
      context: { catalogId, itemCount: list.length },
    });
    throw error;
  }
};

/** Best-effort local copy of a list the caller already holds from another source; losing it is not a failure. */
export const cacheCatalogValues = async <T = string>(catalogId: string, list: T[]): Promise<void> =>
  saveCatalogValues<T>(catalogId, list).catch(() => undefined);

export const clearCatalog = async (catalogId: string): Promise<void> => {
  try {
    await ensureDbReady();
    await db.catalogs.delete(catalogId);
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_clear_catalog', error, {
      code: 'indexeddb_clear_catalog_failed',
      message: `No fue posible limpiar el catalogo ${catalogId}.`,
      severity: 'warning',
      userSafeMessage: 'No fue posible limpiar un catalogo local.',
      context: { catalogId },
    });
  }
};

export const getCatalog = async (catalogId: string): Promise<string[]> => {
  return await getCatalogValues<string>(catalogId);
};

export const saveCatalog = async (catalogId: string, list: string[]): Promise<void> => {
  await saveCatalogValues<string>(catalogId, list);
};
