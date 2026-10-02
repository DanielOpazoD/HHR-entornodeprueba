// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  getIndexedDbRecoveryBudgetSnapshot,
  INDEXED_DB_DELETE_TIMEOUT_MS,
  INDEXED_DB_OPEN_TIMEOUT_MS,
  INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
  MAX_BACKGROUND_RECOVERY_ATTEMPTS,
} from '@/services/storage/indexeddb/indexedDbRecoveryBudgets';

describe('indexedDbRecoveryBudgets', () => {
  it('exposes the IndexedDB recovery budget snapshot', () => {
    expect(getIndexedDbRecoveryBudgetSnapshot()).toEqual({
      openTimeoutMs: INDEXED_DB_OPEN_TIMEOUT_MS,
      deleteTimeoutMs: INDEXED_DB_DELETE_TIMEOUT_MS,
      retryDelaysMs: INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
      maxBackgroundRecoveryAttempts: MAX_BACKGROUND_RECOVERY_ATTEMPTS,
    });
  });
});
