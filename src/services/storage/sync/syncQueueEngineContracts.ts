import type {
  SyncQueueStorePort,
  SyncRuntimePort,
  SyncTransportPort,
} from '@/services/storage/sync/syncQueuePorts';

export interface CreateSyncQueueEngineOptions {
  store: SyncQueueStorePort;
  runtime: SyncRuntimePort;
  transport: SyncTransportPort;
  batchSize: number;
  maxPendingTasks: number;
  maxRetries: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
}

export interface SyncQueueEnqueueResult {
  accepted: boolean;
  mode: 'created' | 'reused' | 'rejected_backpressure' | 'enqueue_failed';
  pendingTasks: number;
  maxPendingTasks: number;
}
