import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { clearSyncTaskRuntimeState } from '@/services/storage/sync/syncQueueTaskFactory';

/** Keep owned edits recoverable after logout, without allowing the next actor to publish them. */
export const preserveNursingSessionQueue = async (ownerKey: string): Promise<void> => {
  await ensureDbReady();
  await hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
    const tasks = await hospitalDB.syncQueue.toArray();
    for (const task of tasks) {
      if (task.id === undefined || (task.ownerKey && task.ownerKey !== ownerKey)) continue;
      await hospitalDB.syncQueue.update(task.id, {
        ...clearSyncTaskRuntimeState(),
        // Unattributed legacy work is not silently adopted by the person signing in next.
        ownerKey: task.ownerKey || `unattributed:${task.opId}`,
        status: task.status === 'RETIRED' || task.status === 'CONFLICT' ? task.status : 'FAILED',
        error:
          'Sesión cerrada. Revisa los cambios pendientes con su usuario original antes de reintentar.',
        lastErrorCode: 'session_owner_logged_out',
        lastErrorCategory: 'authorization',
        lastErrorSeverity: 'medium',
        lastErrorAction: 'review_owned_pending_changes',
      });
    }
  });
};
