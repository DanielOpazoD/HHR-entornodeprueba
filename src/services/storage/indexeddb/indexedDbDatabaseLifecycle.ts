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

export interface CreateIndexedDbDatabaseOrFallbackOptions<
  TDatabase extends IndexedDbTableMap,
  TFallback extends IndexedDbTableMap = IndexedDbDatabaseLike,
> {
  createDatabase: () => TDatabase;
  createMockDatabase: () => TFallback;
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

export const createIndexedDbDatabaseOrFallback = <
  TDatabase extends IndexedDbTableMap,
  TFallback extends IndexedDbTableMap = IndexedDbDatabaseLike,
>({
  createDatabase,
  createMockDatabase,
  attachDatabaseEvents,
  recordRecoveryFailure = recordIndexedDbRecoveryFailure,
  recordFallbackMode = recordIndexedDbFallbackMode,
  getBudgetSnapshot = getIndexedDbRecoveryBudgetSnapshot,
}: CreateIndexedDbDatabaseOrFallbackOptions<
  TDatabase,
  TFallback
>): IndexedDbDatabaseCreationOutcome<TDatabase | TFallback> => {
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
      database: createMockDatabase(),
      fallbackMode: true,
    };
  }
};
