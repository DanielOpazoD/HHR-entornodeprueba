import type { SyncQueueOperationSnapshot, SyncQueueTelemetry } from '@/services/storage/sync';
import type { SyncQueueRuntimeState } from '@/services/storage/sync/syncQueueOperationalBudgets';

export interface SyncQueueStats {
  pending: number;
  failed: number;
  retrying: number;
  acked: number;
  conflict: number;
  /** Edad de la tarea pendiente más antigua; distingue el vuelo normal de un atasco. */
  oldestPendingAgeMs: number;
  batchSize?: number;
  runtimeState?: SyncQueueRuntimeState;
  readState?: 'ok' | 'unavailable';
  recentOperationsReadState?: 'ok' | 'unavailable';
}

export interface SyncQueueOperation {
  id?: SyncQueueOperationSnapshot['id'];
  type: SyncQueueOperationSnapshot['type'];
  status: SyncQueueOperationSnapshot['status'];
  retryCount: number;
  timestamp: number;
  nextAttemptAt?: number;
  error?: string;
  lastErrorCode?: SyncQueueOperationSnapshot['lastErrorCode'];
  lastErrorCategory?: SyncQueueOperationSnapshot['lastErrorCategory'];
  lastErrorSeverity?: SyncQueueOperationSnapshot['lastErrorSeverity'];
  lastErrorAction?: SyncQueueOperationSnapshot['lastErrorAction'];
  lastErrorAt?: SyncQueueOperationSnapshot['lastErrorAt'];
  key?: string;
  contexts?: SyncQueueOperationSnapshot['contexts'];
  origin?: SyncQueueOperationSnapshot['origin'];
  recoveryPolicy?: SyncQueueOperationSnapshot['recoveryPolicy'];
}

export const EMPTY_SYNC_QUEUE_STATS: SyncQueueStats = {
  pending: 0,
  failed: 0,
  retrying: 0,
  acked: 0,
  conflict: 0,
  oldestPendingAgeMs: 0,
};

export const buildSyncQueueStats = (
  telemetry: SyncQueueTelemetry,
  recentOperationsReadState: SyncQueueStats['recentOperationsReadState'] = 'ok'
): SyncQueueStats => ({
  pending: telemetry.pending,
  failed: telemetry.failed,
  retrying: telemetry.retrying,
  acked: 0,
  conflict: telemetry.conflict || 0,
  oldestPendingAgeMs: telemetry.oldestPendingAgeMs || 0,
  batchSize: telemetry.batchSize,
  runtimeState: telemetry.runtimeState,
  readState: telemetry.readState,
  recentOperationsReadState,
});

export const buildUnavailableSyncQueueStats = (
  recentOperationsReadState: SyncQueueStats['recentOperationsReadState'] = 'unavailable'
): SyncQueueStats => ({
  ...EMPTY_SYNC_QUEUE_STATS,
  readState: 'unavailable',
  recentOperationsReadState,
});

export const hasSyncQueueIssues = (stats: SyncQueueStats): boolean =>
  stats.pending > 0 ||
  stats.retrying > 0 ||
  stats.failed > 0 ||
  stats.conflict > 0 ||
  stats.runtimeState === 'degraded' ||
  stats.runtimeState === 'blocked' ||
  stats.readState === 'unavailable' ||
  stats.recentOperationsReadState === 'unavailable';
