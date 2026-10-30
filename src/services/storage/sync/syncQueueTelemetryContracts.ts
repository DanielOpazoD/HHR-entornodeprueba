import type {
  SyncQueueBudgetState,
  SyncQueueRuntimeState,
} from '@/services/storage/sync/syncQueueOperationalBudgets';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

export type SyncQueueTelemetryRow = Pick<
  SyncTask,
  'status' | 'timestamp' | 'origin' | 'retryCount'
>;

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
