/**
 * Internal flow helpers extracted from indexedDbCore so the orchestrator
 * (ensureDbReady) stays under the module-size guardrail and reads as a
 * three-branch decision instead of a 107-line procedure. None of these
 * helpers are part of the public IndexedDB API; they are local to the
 * indexedDbCore module and accept their dependencies through inputs so
 * they remain pure / testable.
 */

import type { HangaRoaDatabase } from './indexedDbDatabase';
import {
  assignIndexedDbMockTables,
  createIndexedDbDatabaseOrFallback,
} from './indexedDbDatabaseLifecycle';
import {
  recoverIndexedDbInitialOpenRuntimeFailure,
  restoreIndexedDbFromMockFallback,
} from './indexedDbCoreRecovery';
import { recordIndexedDbRecoveryFailure } from './indexedDbRecoveryController';
import {
  openIndexedDbWithRetries,
  runIndexedDbOperationWithTimeout,
  waitForIndexedDbOpenResolution,
} from './indexedDbCoreSupport';
import { resolveIndexedDbOpenWaitAction } from './indexedDbOpenWaitController';
import {
  INDEXED_DB_OPEN_TIMEOUT_MS,
  INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
} from './indexedDbRecoveryBudgets';
import { createMockDatabase } from './indexedDbMockFactory';

export interface MockFallbackRecoveryInput {
  currentDatabase: HangaRoaDatabase;
  createDatabase: () => HangaRoaDatabase;
  attachDatabaseEvents: (database: HangaRoaDatabase) => void;
  resetRecoveryTracking: () => void;
}

export interface MockFallbackRecoveryResult {
  database: HangaRoaDatabase;
  fallbackMode: boolean;
}

/**
 * Attempts to bring the database back from the in-memory mock fallback to
 * a real IndexedDB instance. Returns the resolved database + whether we are
 * still in fallback mode after the attempt.
 */
export const runMockFallbackRecovery = (
  input: MockFallbackRecoveryInput
): MockFallbackRecoveryResult => {
  const recoveryOutcome = restoreIndexedDbFromMockFallback({
    currentDatabase: input.currentDatabase,
    createDatabase: input.createDatabase,
    attachDatabaseEvents: input.attachDatabaseEvents,
    resetRecoveryTracking: input.resetRecoveryTracking,
    assignMockTables: assignIndexedDbMockTables,
    createMockDatabase,
    recordRecoveryFailure: recordIndexedDbRecoveryFailure,
  });

  return {
    database: recoveryOutcome.database,
    fallbackMode: recoveryOutcome.fallbackMode,
  };
};

export interface OpeningWaitInput {
  isOpening: () => boolean;
  isDbOpen: () => boolean;
  isUsingMock: () => boolean;
}

export type OpeningWaitDecision = 'return' | 'fallback' | 'continue';

/**
 * Coordinates the wait branch when a concurrent open is already in flight.
 * Returns 'return' to short-circuit, 'fallback' to switch into the mock
 * (caller is responsible for setting state), or 'continue' to fall through
 * to a fresh open attempt.
 */
export const runOpeningWaitFlow = async (input: OpeningWaitInput): Promise<OpeningWaitDecision> => {
  const waitOutcome = await waitForIndexedDbOpenResolution(input);
  return resolveIndexedDbOpenWaitAction(waitOutcome);
};

export interface FreshOpenAttemptInput {
  database: HangaRoaDatabase;
  attachDatabaseEvents: (database: HangaRoaDatabase) => void;
}

export interface FreshOpenAttemptResult {
  database: HangaRoaDatabase;
  fallbackMode: boolean;
  stickyFallbackMode: boolean;
  shouldResetRecoveryTracking: boolean;
  shouldNotifyDatabaseRecreated: boolean;
  shouldScheduleBackgroundRecovery: boolean;
}

/**
 * Runs the open-with-retries path and, if it fails, hands off to the
 * recovery pipeline. Returns the final database + flags the caller uses to
 * update its module state and decide whether to schedule background
 * recovery / notify consumers about the recreation.
 */
export const runFreshOpenAttempt = async (
  input: FreshOpenAttemptInput
): Promise<FreshOpenAttemptResult> => {
  try {
    await openIndexedDbWithRetries({
      open: () =>
        runIndexedDbOperationWithTimeout(
          () => input.database.open(),
          INDEXED_DB_OPEN_TIMEOUT_MS,
          'IndexedDB open timeout'
        ),
      retryDelays: INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
    });

    return {
      database: input.database,
      fallbackMode: false,
      stickyFallbackMode: false,
      shouldResetRecoveryTracking: true,
      shouldNotifyDatabaseRecreated: false,
      shouldScheduleBackgroundRecovery: false,
    };
  } catch (error: unknown) {
    const recoveryOutcome = await recoverIndexedDbInitialOpenRuntimeFailure({
      error,
      database: input.database,
      attachDatabaseEvents: input.attachDatabaseEvents,
    });

    return {
      database: recoveryOutcome.database,
      fallbackMode: recoveryOutcome.fallbackMode,
      stickyFallbackMode: recoveryOutcome.stickyFallbackMode,
      shouldResetRecoveryTracking: recoveryOutcome.shouldResetRecoveryTracking,
      shouldNotifyDatabaseRecreated: recoveryOutcome.shouldNotifyDatabaseRecreated,
      shouldScheduleBackgroundRecovery: recoveryOutcome.shouldScheduleBackgroundRecovery,
    };
  }
};

export interface InitialDatabaseInput {
  createDatabase: () => HangaRoaDatabase;
  attachDatabaseEvents: (database: HangaRoaDatabase) => void;
}

export interface InitialDatabaseOutcome {
  database: HangaRoaDatabase;
  fallbackMode: boolean;
}

/**
 * Wraps the createIndexedDbDatabaseOrFallback factory so the orchestrator
 * does not need to know about the createMockDatabase/attachDatabaseEvents
 * plumbing at module evaluation time.
 */
export const initializeIndexedDbDatabase = (
  input: InitialDatabaseInput
): InitialDatabaseOutcome => {
  const outcome = createIndexedDbDatabaseOrFallback({
    createDatabase: input.createDatabase,
    createMockDatabase,
    attachDatabaseEvents: input.attachDatabaseEvents,
  });

  return {
    database: outcome.database,
    fallbackMode: outcome.fallbackMode,
  };
};
