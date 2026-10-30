import {
  ensureDbReady,
  hospitalDB,
  isDatabaseInFallbackMode,
} from '@/services/storage/indexeddb/indexedDbCore';
import { dispatchDailyRecordStoreChanged } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { clearSyncTaskRuntimeState } from '@/services/storage/sync/syncQueueTaskFactory';
import { holdsDailyRecordProjection } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

/** A whole-day write that still holds the stored day, whose copy logout clears. */
const holdsClearedDay = (task: SyncTask): boolean => {
  const date = (task.payload as { date?: unknown } | null | undefined)?.date;
  return typeof date === 'string' && holdsDailyRecordProjection(task, date);
};

/**
 * Keep owned edits recoverable after logout, without allowing the next actor to publish them.
 * Every day write, of any owner, loses its stored copy with the days: it is released and blocked,
 * with no attempt left to continue, so no session reads, absorbs or publishes it as that day again
 * and its owner finds it ready for review.
 */
const preserveSessionSyncQueue = async (ownerKey: string | null): Promise<void> => {
  for (const task of await hospitalDB.syncQueue.toArray()) {
    if (task.id === undefined) continue;
    const owned = !task.ownerKey || task.ownerKey === ownerKey;
    const releases = holdsClearedDay(task);
    if (!owned && !releases) continue;
    await hospitalDB.syncQueue.update(task.id, {
      ...(releases ? { projectionReleased: true as const } : {}),
      // Unattributed legacy work is not silently adopted by the person signing in next.
      ...(owned ? { ownerKey: task.ownerKey || `unattributed:${task.opId}` } : {}),
      // Already blocked sends and retired backups keep their original status and diagnosis.
      ...(task.status === 'PENDING' || task.status === 'PROCESSING'
        ? {
            ...clearSyncTaskRuntimeState(),
            status: 'FAILED' as const,
            error: 'Sesión cerrada. Revisa los cambios pendientes con su usuario original.',
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
 * Clears every stored day and keeps the queue recoverable, in one transaction when the days live in
 * IndexedDB: either both commit or neither does. Any failure fails the logout, which keeps the next
 * person out and retries this step.
 */
export const clearSessionDailyRecords = async (ownerKey: string | null): Promise<void> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      // No transaction spans the fallback store. Days go first: patient data leaves this browser
      // even if the queue step fails, and a failed clear has not changed the queue. The failed
      // cleanup stands this document's queue worker down until this step succeeds on retry.
      localPersistence.records.clear();
      await hospitalDB.transaction('rw', hospitalDB.syncQueue, () =>
        preserveSessionSyncQueue(ownerKey)
      );
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
    });
    throw error;
  }
  dispatchDailyRecordStoreChanged({ operation: 'clear' });
};
