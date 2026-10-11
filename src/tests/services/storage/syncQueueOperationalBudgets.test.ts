// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  resolveSyncQueueBudgetState,
  resolveSyncQueueRuntimeState,
  SYNC_QUEUE_RUNTIME_THRESHOLDS,
} from '@/services/storage/sync/syncQueueOperationalBudgets';

describe('syncQueueOperationalBudgets', () => {
  it('maps values to ok, warning and critical budget states', () => {
    expect(resolveSyncQueueBudgetState(0, 1, 3)).toBe('ok');
    expect(resolveSyncQueueBudgetState(1, 1, 3)).toBe('warning');
    expect(resolveSyncQueueBudgetState(3, 1, 3)).toBe('critical');
  });

  it('escalates runtime state based on oldest pending age and retry counts', () => {
    expect(resolveSyncQueueRuntimeState(0, 0, 0)).toBe('ok');
    expect(
      resolveSyncQueueRuntimeState(0, SYNC_QUEUE_RUNTIME_THRESHOLDS.warningOldestPendingAgeMs, 0)
    ).toBe('degraded');
    expect(
      resolveSyncQueueRuntimeState(0, 0, SYNC_QUEUE_RUNTIME_THRESHOLDS.criticalRetryingSyncTasks)
    ).toBe('blocked');
  });
});
