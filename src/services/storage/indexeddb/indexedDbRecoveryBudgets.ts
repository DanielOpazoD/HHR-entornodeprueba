export const INDEXED_DB_OPEN_TIMEOUT_MS = 12_000;
export const INDEXED_DB_RECOVERY_RETRY_DELAYS_MS = [500, 1_500, 4_000, 8_000] as const;
export const MAX_BACKGROUND_RECOVERY_ATTEMPTS = 6;

export interface IndexedDbRecoveryBudgetSnapshot {
  openTimeoutMs: number;
  retryDelaysMs: readonly number[];
  maxBackgroundRecoveryAttempts: number;
}

export const getIndexedDbRecoveryBudgetSnapshot = (): IndexedDbRecoveryBudgetSnapshot => ({
  openTimeoutMs: INDEXED_DB_OPEN_TIMEOUT_MS,
  retryDelaysMs: INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
  maxBackgroundRecoveryAttempts: MAX_BACKGROUND_RECOVERY_ATTEMPTS,
});
