/**
 * Internal flow helpers extracted from indexedDbCore so the orchestrator
 * (ensureDbReady) stays under the module-size guardrail and reads as a
 * three-branch decision instead of a 107-line procedure. None of these
 * helpers are part of the public IndexedDB API; they are local to the
 * indexedDbCore module and accept their dependencies through inputs so
 * they remain pure / testable.
 */

import type { IndexedDbDatabaseLike } from './indexedDbContracts';
import {
  createIndexedDbDatabaseOrFallback,
  type IndexedDbDatabaseCreationOutcome,
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
import {
  INDEXED_DB_OPEN_TIMEOUT_MS,
  INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
} from './indexedDbRecoveryBudgets';
import { createMockDatabase } from './indexedDbMockFactory';

export interface MockFallbackRecoveryInput {
  currentDatabase: IndexedDbDatabaseLike;
  createDatabase: () => IndexedDbDatabaseLike;
  attachDatabaseEvents: (database: IndexedDbDatabaseLike) => void;
}

/**
 * Attempts to bring the database back from the in-memory mock fallback to
 * a real IndexedDB instance. Returns the resolved database + whether we are
 * still in fallback mode after the attempt.
 */
export const runMockFallbackRecovery = (
  input: MockFallbackRecoveryInput
): IndexedDbDatabaseCreationOutcome<IndexedDbDatabaseLike> => {
  return restoreIndexedDbFromMockFallback({
    ...input,
    recordRecoveryFailure: recordIndexedDbRecoveryFailure,
  });
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
  if (waitOutcome === 'opened' || waitOutcome === 'mock') {
    return 'return';
  }
  return waitOutcome === 'stalled' ? 'fallback' : 'continue';
};

export interface FreshOpenAttemptInput {
  database: IndexedDbDatabaseLike;
}

/**
 * Runs the open-with-retries path and, if it fails, hands off to the
 * recovery pipeline. The caller schedules a retry while the database is in memory.
 */
export const runFreshOpenAttempt = async (
  input: FreshOpenAttemptInput
): Promise<IndexedDbDatabaseCreationOutcome<IndexedDbDatabaseLike>> => {
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
    };
  } catch (error: unknown) {
    return recoverIndexedDbInitialOpenRuntimeFailure({ error, database: input.database });
  }
};

export interface InitialDatabaseInput {
  createDatabase: () => IndexedDbDatabaseLike;
  attachDatabaseEvents: (database: IndexedDbDatabaseLike) => void;
}

/**
 * Wraps the createIndexedDbDatabaseOrFallback factory so the orchestrator
 * does not need to know about the createMockDatabase/attachDatabaseEvents
 * plumbing at module evaluation time.
 */
export const initializeIndexedDbDatabase = (
  input: InitialDatabaseInput
): IndexedDbDatabaseCreationOutcome<IndexedDbDatabaseLike> => {
  return createIndexedDbDatabaseOrFallback({ ...input, createMockDatabase });
};
