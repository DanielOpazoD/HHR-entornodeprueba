import type {
  SyncQueueBudgetState,
  SyncQueueRuntimeState,
} from '@/services/storage/sync/syncQueueOperationalBudgets';

export interface SyncQueueTelemetry {
  pending: number;
  failed: number;
  conflict: number;
  retrying: number;
  orphanedTasks?: number;
  oldestPendingAgeMs: number;
  oldestDirectQueueAgeMs?: number;
  batchSize: number;
  pendingBudgetState?: SyncQueueBudgetState;
  oldestPendingBudgetState: SyncQueueBudgetState;
  directQueueBudgetState?: SyncQueueBudgetState;
  retryingBudgetState: SyncQueueBudgetState;
  runtimeState: SyncQueueRuntimeState;
  readState?: 'ok' | 'unavailable';
  issues?: string[];
  ownerKey?: string | null;
}
