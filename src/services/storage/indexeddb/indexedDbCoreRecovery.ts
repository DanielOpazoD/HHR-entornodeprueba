import { assignIndexedDbMockTables } from './indexedDbDatabaseLifecycle';
import { createMockDatabase } from './indexedDbMockFactory';
import type { IndexedDbDatabaseLike } from './indexedDbContracts';
import { recoverIndexedDbInitialOpenFailure } from './indexedDbInitialOpenRecoveryController';

interface RestoreIndexedDbFromMockFallbackOptions<Database extends IndexedDbDatabaseLike> {
  currentDatabase: Database;
  createDatabase: () => Database;
  attachDatabaseEvents: (database: Database) => void;
  resetRecoveryTracking: () => void;
  assignMockTables: (database: Database, mockDatabase: IndexedDbDatabaseLike) => void;
  createMockDatabase: () => IndexedDbDatabaseLike;
  recordRecoveryFailure: (error: unknown) => void;
}

interface RestoreIndexedDbFromMockFallbackOutcome<Database extends IndexedDbDatabaseLike> {
  database: Database;
  fallbackMode: boolean;
}

export const restoreIndexedDbFromMockFallback = <Database extends IndexedDbDatabaseLike>({
  currentDatabase,
  createDatabase,
  attachDatabaseEvents,
  resetRecoveryTracking,
  assignMockTables,
  createMockDatabase,
  recordRecoveryFailure,
}: RestoreIndexedDbFromMockFallbackOptions<Database>): RestoreIndexedDbFromMockFallbackOutcome<Database> => {
  try {
    const database = createDatabase();
    attachDatabaseEvents(database);
    resetRecoveryTracking();

    return {
      database,
      fallbackMode: false,
    };
  } catch (error) {
    recordRecoveryFailure(error);
    assignMockTables(currentDatabase, createMockDatabase());

    return {
      database: currentDatabase,
      fallbackMode: true,
    };
  }
};

interface RecoverIndexedDbInitialOpenRuntimeFailureOptions<Database extends IndexedDbDatabaseLike> {
  error: unknown;
  database: Database;
  activateMockFallback?: () => Database;
}

export const recoverIndexedDbInitialOpenRuntimeFailure = async <
  Database extends IndexedDbDatabaseLike,
>({
  error,
  database,
  activateMockFallback = () => {
    assignIndexedDbMockTables(database, createMockDatabase());
    return database;
  },
}: RecoverIndexedDbInitialOpenRuntimeFailureOptions<Database>) =>
  recoverIndexedDbInitialOpenFailure({ error, activateMockFallback });
