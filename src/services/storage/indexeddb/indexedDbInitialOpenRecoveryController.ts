import { getIndexedDbRecoveryBudgetSnapshot } from './indexedDbRecoveryBudgets';
import { shouldUseStickyIndexedDbFallback } from './indexedDbRecoveryPolicy';
import { resolveIndexedDbErrorDetails } from './indexedDbCoreSupport';
import {
  recordIndexedDbFallbackMode,
  recordIndexedDbRecoveryNotice,
} from './indexedDbRecoveryController';

export interface IndexedDbInitialOpenRecoveryOutcome<TDatabase> {
  database: TDatabase;
  fallbackMode: boolean;
  stickyFallbackMode: boolean;
  shouldScheduleBackgroundRecovery: boolean;
}

export interface IndexedDbInitialOpenRecoveryOptions<TDatabase> {
  error: unknown;
  activateMockFallback: () => TDatabase;
  getBudgetSnapshot?: () => object;
  shouldUseStickyFallback?: (error: unknown) => boolean;
  recordRecoveryNotice?: typeof recordIndexedDbRecoveryNotice;
  recordFallbackMode?: typeof recordIndexedDbFallbackMode;
}

/**
 * When HangaRoaDB cannot be opened, the app keeps working on in-memory tables and retries the real
 * database in the background. It never deletes it on its own: the database holds the sync queue
 * and the local records, and the usual causes (a VersionError after a newer app version upgraded
 * it, a transient UnknownError) leave that data readable later. Only the explicit reset offered by
 * the storage status badge deletes it.
 */
export const recoverIndexedDbInitialOpenFailure = async <TDatabase>({
  error,
  activateMockFallback,
  getBudgetSnapshot = getIndexedDbRecoveryBudgetSnapshot,
  shouldUseStickyFallback = shouldUseStickyIndexedDbFallback,
  recordRecoveryNotice = recordIndexedDbRecoveryNotice,
  recordFallbackMode = recordIndexedDbFallbackMode,
}: IndexedDbInitialOpenRecoveryOptions<TDatabase>): Promise<
  IndexedDbInitialOpenRecoveryOutcome<TDatabase>
> => {
  const { errorName, errorMessage } = resolveIndexedDbErrorDetails(error);
  const budgetSnapshot: Record<string, unknown> = { ...getBudgetSnapshot() };

  recordRecoveryNotice(
    'indexeddb_initial_open_failed',
    'La apertura inicial de IndexedDB fallo; la app sigue en memoria y reintentara sin borrar la base local.',
    {
      errorName,
      errorMessage,
      ...budgetSnapshot,
    }
  );
  recordFallbackMode(errorName, errorMessage || 'IndexedDB fallback activated', budgetSnapshot);

  return {
    database: activateMockFallback(),
    fallbackMode: true,
    stickyFallbackMode: shouldUseStickyFallback(error),
    shouldScheduleBackgroundRecovery: true,
  };
};
