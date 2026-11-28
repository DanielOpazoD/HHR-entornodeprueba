import { recordIndexedDbRecoveryNotice } from './indexedDbRecoveryController';
import { resolveIndexedDbRecoveryDelay } from './indexedDbCoreSupport';
import {
  INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
  MAX_BACKGROUND_RECOVERY_ATTEMPTS,
  getIndexedDbRecoveryBudgetSnapshot,
} from './indexedDbRecoveryBudgets';

interface IndexedDbBackgroundRecoverySchedulerDependencies {
  onRetry: () => void;
}

export interface IndexedDbBackgroundRecoveryScheduler {
  reset: () => void;
  schedule: () => void;
}

export const createIndexedDbBackgroundRecoveryScheduler = ({
  onRetry,
}: IndexedDbBackgroundRecoverySchedulerDependencies): IndexedDbBackgroundRecoveryScheduler => {
  let recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let backgroundRecoveryAttempts = 0;

  const reset = () => {
    backgroundRecoveryAttempts = 0;
    if (recoveryRetryTimer) clearTimeout(recoveryRetryTimer);
    recoveryRetryTimer = null;
  };

  const schedule = () => {
    if (recoveryRetryTimer || typeof window === 'undefined') return;

    if (backgroundRecoveryAttempts >= MAX_BACKGROUND_RECOVERY_ATTEMPTS) {
      recordIndexedDbRecoveryNotice(
        'indexeddb_recovery_stopped',
        'Se detuvo la recuperacion en segundo plano de IndexedDB.',
        {
          attempts: MAX_BACKGROUND_RECOVERY_ATTEMPTS,
          ...getIndexedDbRecoveryBudgetSnapshot(),
        },
        'recoverable'
      );
      return;
    }

    backgroundRecoveryAttempts++;
    const scheduledDelayMs = resolveIndexedDbRecoveryDelay(
      backgroundRecoveryAttempts,
      INDEXED_DB_RECOVERY_RETRY_DELAYS_MS
    );
    recoveryRetryTimer = setTimeout(() => {
      recoveryRetryTimer = null;
      onRetry();
    }, scheduledDelayMs);
    recordIndexedDbRecoveryNotice(
      'indexeddb_recovery_retry_scheduled',
      'Se programo un nuevo intento de recuperacion de IndexedDB.',
      {
        attempt: backgroundRecoveryAttempts,
        scheduledDelayMs,
        ...getIndexedDbRecoveryBudgetSnapshot(),
      },
      'retryable'
    );
  };

  return {
    reset,
    schedule,
  };
};
