import { createIndexedDbBackgroundRecoveryScheduler } from './indexedDbBackgroundRecoveryScheduler';
import { HangaRoaDatabase } from './indexedDbDatabase';
import { attachIndexedDbEvents } from './indexedDbBootstrap';
import { recordIndexedDbRecoveryNotice } from './indexedDbRecoveryController';
import { resolveIndexedDbOpenHealth } from './indexedDbOpenHealthController';
import { getIndexedDbRecoveryBudgetSnapshot } from './indexedDbRecoveryBudgets';
import {
  buildLocalPersistenceRuntimeSnapshot,
  hasE2ERuntimeOverride,
  shouldAttemptMockRecovery,
  shouldSkipReadyCheckForMock,
  type LocalPersistenceRuntimeSnapshot,
} from './indexedDbRuntimeModeController';
import {
  initializeIndexedDbDatabase,
  runFreshOpenAttempt,
  runMockFallbackRecovery,
  runOpeningWaitFlow,
} from './indexedDbCoreFlows';

let db: HangaRoaDatabase;
let isUsingMock = false;
let isOpening = false;
let onDatabaseRecreated: (() => void) | null = null;
let stickyFallbackMode = false;
const emittedIndexedDbWarnings = new Set<string>();

const backgroundRecoveryScheduler = createIndexedDbBackgroundRecoveryScheduler({
  getStickyFallbackMode: () => stickyFallbackMode,
  onRetry: () => {
    void ensureDbReady({ allowRecoveryWhenMock: true });
  },
});

const attachDatabaseEvents = (database: HangaRoaDatabase) =>
  attachIndexedDbEvents(
    database,
    () => ({ isUsingMock, stickyFallbackMode }),
    emittedIndexedDbWarnings
  );

const initializeDatabase = () => {
  const outcome = initializeIndexedDbDatabase({
    createDatabase: () => new HangaRoaDatabase(),
    attachDatabaseEvents,
  });

  db = outcome.database;
  isUsingMock = outcome.fallbackMode;
};

const resetIndexedDbRecoveryTracking = () => {
  stickyFallbackMode = false;
  backgroundRecoveryScheduler.reset();
  emittedIndexedDbWarnings.clear();
};

initializeDatabase();

export const registerDatabaseRecreatedHandler = (handler: () => void): void => {
  onDatabaseRecreated = handler;
};

interface EnsureDbReadyOptions {
  allowRecoveryWhenMock?: boolean;
}

export type { LocalPersistenceRuntimeSnapshot };

export const ensureDbReady = async (options: EnsureDbReadyOptions = {}): Promise<void> => {
  const { allowRecoveryWhenMock = false } = options;

  if (hasE2ERuntimeOverride()) {
    isUsingMock = true;
    return;
  }

  if (shouldSkipReadyCheckForMock({ isUsingMock, allowRecoveryWhenMock })) return;
  if (shouldAttemptMockRecovery({ isUsingMock, allowRecoveryWhenMock, stickyFallbackMode })) {
    const recoveryOutcome = runMockFallbackRecovery({
      currentDatabase: db,
      createDatabase: () => new HangaRoaDatabase(),
      attachDatabaseEvents,
      resetRecoveryTracking: resetIndexedDbRecoveryTracking,
    });

    db = recoveryOutcome.database;
    isUsingMock = recoveryOutcome.fallbackMode;

    if (recoveryOutcome.fallbackMode) {
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
    const openOutcome = await runFreshOpenAttempt({
      database: db,
      attachDatabaseEvents,
    });

    db = openOutcome.database;
    isUsingMock = openOutcome.fallbackMode;
    stickyFallbackMode = stickyFallbackMode || openOutcome.stickyFallbackMode;

    if (openOutcome.shouldResetRecoveryTracking) {
      resetIndexedDbRecoveryTracking();
    }

    if (openOutcome.shouldNotifyDatabaseRecreated) {
      onDatabaseRecreated?.();
    }

    if (openOutcome.fallbackMode && openOutcome.shouldScheduleBackgroundRecovery) {
      backgroundRecoveryScheduler.schedule();
    }
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
    stickyFallbackMode,
  });

export { db as hospitalDB };
export { createMockDatabase } from './indexedDbMockFactory';
export { HangaRoaDatabase } from './indexedDbDatabase';
