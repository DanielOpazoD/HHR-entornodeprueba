import type { IndexedDbDatabaseLike, IndexedDbTableMap } from './indexedDbContracts';
import { getIndexedDbRecoveryBudgetSnapshot } from './indexedDbRecoveryBudgets';
import {
  recordIndexedDbFallbackMode,
  recordIndexedDbRecoveryFailure,
} from './indexedDbRecoveryController';

const CONSTRUCT_FAILED_FALLBACK_MESSAGE =
  'IndexedDB no pudo inicializarse y se activo el modo fallback local.';

export interface IndexedDbDatabaseCreationOutcome<TDatabase> {
  database: TDatabase;
  fallbackMode: boolean;
}

export interface CreateIndexedDbDatabaseOrFallbackOptions<TDatabase extends IndexedDbTableMap> {
  createDatabase: () => TDatabase;
  createMockDatabase: () => IndexedDbDatabaseLike;
  attachDatabaseEvents: (database: TDatabase) => void;
  recordRecoveryFailure?: typeof recordIndexedDbRecoveryFailure;
  recordFallbackMode?: typeof recordIndexedDbFallbackMode;
  getBudgetSnapshot?: () => object;
}

export const assignIndexedDbMockTables = <TDatabase extends IndexedDbTableMap>(
  database: TDatabase,
  mock: IndexedDbTableMap
): TDatabase => {
  database.dailyRecords = mock.dailyRecords;
  database.catalogs = mock.catalogs;
  database.errorLogs = mock.errorLogs;
  database.auditLogs = mock.auditLogs;
  database.settings = mock.settings;
  database.syncQueue = mock.syncQueue;

  return database;
};

export const createIndexedDbDatabaseOrFallback = <TDatabase extends IndexedDbTableMap>({
  createDatabase,
  createMockDatabase,
  attachDatabaseEvents,
  recordRecoveryFailure = recordIndexedDbRecoveryFailure,
  recordFallbackMode = recordIndexedDbFallbackMode,
  getBudgetSnapshot = getIndexedDbRecoveryBudgetSnapshot,
}: CreateIndexedDbDatabaseOrFallbackOptions<TDatabase>): IndexedDbDatabaseCreationOutcome<TDatabase> => {
  try {
    const database = createDatabase();
    attachDatabaseEvents(database);

    return {
      database,
      fallbackMode: false,
    };
  } catch (error) {
    recordRecoveryFailure(error);
    recordFallbackMode('construct_failed', CONSTRUCT_FAILED_FALLBACK_MESSAGE, {
      ...getBudgetSnapshot(),
    });

    return {
      // In-memory stand-in when IndexedDB cannot open; it implements only the tables' methods used.
      database: createMockDatabase() as unknown as TDatabase,
      fallbackMode: true,
    };
  }
};
