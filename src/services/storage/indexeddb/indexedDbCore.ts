import { createIndexedDbBackgroundRecoveryScheduler } from './indexedDbBackgroundRecoveryScheduler';
import type { IndexedDbDatabaseLike } from './indexedDbContracts';
import { HangaRoaDatabase } from './indexedDbDatabase';
import { attachIndexedDbWarningBindings } from './indexedDbWarningBindings';
import { recordIndexedDbRecoveryNotice } from './indexedDbRecoveryController';
import { resolveIndexedDbOpenHealth } from './indexedDbCoreSupport';
import { getIndexedDbRecoveryBudgetSnapshot } from './indexedDbRecoveryBudgets';
import {
  buildLocalPersistenceRuntimeSnapshot,
  type LocalPersistenceRuntimeSnapshot,
} from './indexedDbRuntimeModeController';
import {
  initializeIndexedDbDatabase,
  runFreshOpenAttempt,
  runMockFallbackRecovery,
  runOpeningWaitFlow,
} from './indexedDbCoreFlows';

let db: IndexedDbDatabaseLike;
let isUsingMock = false;
let isOpening = false;
const emittedIndexedDbWarnings = new Set<string>();

const backgroundRecoveryScheduler = createIndexedDbBackgroundRecoveryScheduler({
  onRetry: () => {
    void ensureDbReady({ allowRecoveryWhenMock: true });
  },
});

const attachDatabaseEvents = (database: IndexedDbDatabaseLike) =>
  attachIndexedDbWarningBindings(database, () => isUsingMock, emittedIndexedDbWarnings);

const initializeDatabase = () => {
  const outcome = initializeIndexedDbDatabase({
    createDatabase: () => new HangaRoaDatabase(),
    attachDatabaseEvents,
  });

  db = outcome.database;
  isUsingMock = outcome.fallbackMode;
};

const resetIndexedDbRecoveryTracking = () => {
  backgroundRecoveryScheduler.reset();
  emittedIndexedDbWarnings.clear();
};

initializeDatabase();

interface EnsureDbReadyOptions {
  allowRecoveryWhenMock?: boolean;
}

export type { LocalPersistenceRuntimeSnapshot };

export const ensureDbReady = async (options: EnsureDbReadyOptions = {}): Promise<void> => {
  const { allowRecoveryWhenMock = false } = options;

  if (isUsingMock) {
    if (!allowRecoveryWhenMock) return;
    const recoveryOutcome = runMockFallbackRecovery({
      currentDatabase: db,
      createDatabase: () => new HangaRoaDatabase(),
      attachDatabaseEvents,
    });

    db = recoveryOutcome.database;
    isUsingMock = recoveryOutcome.fallbackMode;

    if (recoveryOutcome.fallbackMode) {
      backgroundRecoveryScheduler.schedule();
      return;
    }
  }

  const openHealth = await resolveIndexedDbOpenHealth(db);
  if (openHealth === 'ready') {
    return;
  }

  if (openHealth === 'closed') {
    recordIndexedDbRecoveryNotice(
      'indexeddb_database_closed',
      'Se detecto cierre inesperado de IndexedDB; se intentara reabrir.',
      { errorName: 'DatabaseClosedError', ...getIndexedDbRecoveryBudgetSnapshot() },
      'retryable'
    );
  }

  if (isOpening) {
    const waitAction = await runOpeningWaitFlow({
      isOpening: () => isOpening,
      isDbOpen: () => db.isOpen(),
      isUsingMock: () => isUsingMock,
    });
    if (waitAction === 'fallback') {
      recordIndexedDbRecoveryNotice(
        'indexeddb_open_stalled',
        'La apertura de IndexedDB excedio el tiempo esperado; se activo fallback.',
        { waitedMs: 5000, ...getIndexedDbRecoveryBudgetSnapshot() },
        'recoverable'
      );
      isUsingMock = true;
    }
    return;
  }

  isOpening = true;
  try {
    const openOutcome = await runFreshOpenAttempt({ database: db });

    db = openOutcome.database;
    isUsingMock = openOutcome.fallbackMode;
    if (isUsingMock) backgroundRecoveryScheduler.schedule();
    else resetIndexedDbRecoveryTracking();
  } finally {
    isOpening = false;
  }
};

export const isIndexedDBAvailable = (): boolean => typeof indexedDB !== 'undefined';

export const isDatabaseInFallbackMode = (): boolean => isUsingMock;

export const getLocalPersistenceRuntimeSnapshot = (): LocalPersistenceRuntimeSnapshot =>
  buildLocalPersistenceRuntimeSnapshot({
    indexedDbAvailable: isIndexedDBAvailable(),
    isUsingMock,
  });

export { db as hospitalDB };
export { createMockDatabase } from './indexedDbMockFactory';
export { HangaRoaDatabase } from './indexedDbDatabase';
