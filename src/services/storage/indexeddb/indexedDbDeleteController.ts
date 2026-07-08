import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';

export const KNOWN_INDEXEDDB_DATABASES_TO_RESET = ['HangaRoaDB', 'firebaseLocalStorageDb'];
const INDEXEDDB_DELETE_TIMEOUT_MS = 1500;

const canUseWindow = (): boolean => typeof window !== 'undefined';

export const deleteIndexedDatabase = (databaseName: string): Promise<void> =>
  new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(() => {
      recordOperationalErrorTelemetry(
        'indexeddb',
        'indexeddb_delete_database_timeout',
        new Error(`IndexedDB delete timed out for ${databaseName}`),
        {
          code: 'indexeddb_delete_database_timeout',
          message: `La limpieza de la base local ${databaseName} no respondió a tiempo.`,
          severity: 'warning',
          userSafeMessage: 'La limpieza de una base local tardó demasiado.',
        }
      );
      finish();
    }, INDEXEDDB_DELETE_TIMEOUT_MS);
    const request = window.indexedDB.deleteDatabase(databaseName);

    request.onsuccess = () => finish();
    request.onerror = () => {
      recordOperationalErrorTelemetry(
        'indexeddb',
        'indexeddb_delete_database',
        request.error ?? new Error(`Failed to delete IndexedDB database ${databaseName}`),
        {
          code: 'indexeddb_delete_database_failed',
          message: `No fue posible limpiar la base local ${databaseName}.`,
          severity: 'warning',
          userSafeMessage: 'No fue posible limpiar una base local del navegador.',
        }
      );
      finish();
    };
    request.onblocked = () => {
      recordOperationalErrorTelemetry(
        'indexeddb',
        'indexeddb_delete_database_blocked',
        new Error(`IndexedDB delete blocked for ${databaseName}`),
        {
          code: 'indexeddb_delete_database_blocked',
          message: `La limpieza de la base local ${databaseName} fue bloqueada por una conexión abierta.`,
          severity: 'warning',
          userSafeMessage: 'La limpieza de una base local fue bloqueada por el navegador.',
        }
      );
      finish();
    };
  });

export const clearIndexedDatabases = async (): Promise<void> => {
  if (!canUseWindow()) return;

  let databaseNames = KNOWN_INDEXEDDB_DATABASES_TO_RESET;

  try {
    const dbs =
      typeof window.indexedDB.databases === 'function' ? await window.indexedDB.databases() : [];
    const enumeratedDatabaseNames = dbs
      .map(dbInfo => dbInfo.name)
      .filter((name): name is string => Boolean(name));
    databaseNames = Array.from(
      new Set([...enumeratedDatabaseNames, ...KNOWN_INDEXEDDB_DATABASES_TO_RESET])
    );
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_clear_databases_enumeration', error, {
      code: 'indexeddb_clear_databases_enumeration_failed',
      message: 'No fue posible enumerar las bases locales IndexedDB; se limpiarán las conocidas.',
      severity: 'warning',
      userSafeMessage: 'No fue posible enumerar todas las bases locales del navegador.',
    });
  }

  try {
    await Promise.all(databaseNames.map(databaseName => deleteIndexedDatabase(databaseName)));
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_clear_databases', error, {
      code: 'indexeddb_clear_databases_failed',
      message: 'No fue posible limpiar las bases locales IndexedDB.',
      severity: 'warning',
      userSafeMessage: 'No fue posible limpiar las bases locales del navegador.',
    });
  }
};
