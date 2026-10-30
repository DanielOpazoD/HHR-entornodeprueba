import {
  ensureDbReady,
  hospitalDB,
  isDatabaseInFallbackMode,
} from '@/services/storage/indexeddb/indexedDbCore';
import { dispatchDailyRecordStoreChanged } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { clearSyncTaskRuntimeState } from '@/services/storage/sync/syncQueueTaskFactory';
import { holdsDailyRecordProjection } from '@/services/storage/sync/dailyRecordSyncQueueReadService';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

/** A whole-day write that still holds the stored day, whose copy logout clears. */
const holdsClearedDay = (task: SyncTask): boolean => {
  const date = (task.payload as { date?: unknown } | null | undefined)?.date;
  return typeof date === 'string' && holdsDailyRecordProjection(task, date);
};

/**
 * Keep owned edits recoverable after logout, without allowing the next actor to publish them.
 * Every day write, of any owner, loses its stored copy with the days: it is released, so no
 * session reads, absorbs or publishes it as that day again.
 */
const preserveSessionSyncQueue = async (ownerKey: string | null): Promise<void> => {
  for (const task of await hospitalDB.syncQueue.toArray()) {
    if (task.id === undefined) continue;
    const owned = !task.ownerKey || task.ownerKey === ownerKey;
    const releases = holdsClearedDay(task);
    if (!owned && !releases) continue;
    await hospitalDB.syncQueue.update(task.id, {
      ...(releases ? { localProjection: 'released' as const } : {}),
      // Unattributed legacy work is not silently adopted by the person signing in next.
      ...(owned ? { ownerKey: task.ownerKey || `unattributed:${task.opId}` } : {}),
      // Already blocked sends and retired backups keep their original status and diagnosis.
      ...(owned && (task.status === 'PENDING' || task.status === 'PROCESSING')
        ? {
            ...clearSyncTaskRuntimeState(),
            status: 'FAILED' as const,
            error:
              'Sesión cerrada. Revisa los cambios pendientes con su usuario original antes de reintentar.',
            lastErrorCode: 'session_owner_logged_out',
            lastErrorCategory: 'authorization' as const,
            lastErrorSeverity: 'medium' as const,
            lastErrorAction: 'review_owned_pending_changes',
          }
        : {}),
    });
  }
};

/**
 * Clears every stored day and keeps the queue recoverable in one transaction: either both commit
 * or neither does, so a failed logout never leaves a day write without its copy, nor a released
 * write beside a copy that should be gone.
 */
export const clearSessionDailyRecords = async (ownerKey: string | null): Promise<void> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      // No transaction spans the fallback store: release first, so a failure keeps both intact.
      await hospitalDB.transaction('rw', hospitalDB.syncQueue, () =>
        preserveSessionSyncQueue(ownerKey)
      );
      localPersistence.records.clear();
    } else {
      await hospitalDB.transaction(
        'rw',
        hospitalDB.dailyRecords,
        hospitalDB.syncQueue,
        async () => {
          await preserveSessionSyncQueue(ownerKey);
          await hospitalDB.dailyRecords.clear();
        }
      );
    }
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_clear_all_records', error, {
      code: 'indexeddb_clear_all_records_failed',
      message: 'No fue posible limpiar los registros locales.',
      severity: 'warning',
      userSafeMessage: 'No fue posible limpiar los registros locales.',
    });
    throw error;
  }
  dispatchDailyRecordStoreChanged({ operation: 'clear' });
};
