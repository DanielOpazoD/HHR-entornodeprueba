import type { SyncQueueStorePort } from '@/services/storage/sync/syncQueuePorts';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

/**
 * Acciones explícitas del usuario sobre tareas en cuarentena (FAILED/CONFLICT),
 * expuestas por el indicador «cambios pendientes de sincronizar» de la barra.
 * Reintentar revive la tarea limpia y dispara el procesamiento; descartar
 * elimina el envío en cola sin tocar lo guardado localmente.
 */

interface QuarantinedSyncTaskActionDependencies {
  ensureReady: () => Promise<void>;
  store: SyncQueueStorePort;
  getOwnerKey: () => string | null;
  logger: { warn: (message: string, error?: unknown) => void };
  recordReadFailure: (operation: string, error: unknown, context?: Record<string, unknown>) => void;
  triggerProcessing: () => void;
}

export const createQuarantinedSyncTaskActions = ({
  ensureReady,
  store,
  getOwnerKey,
  logger,
  recordReadFailure,
  triggerProcessing,
}: QuarantinedSyncTaskActionDependencies) => {
  const runAction = async (
    operation: 'sync_queue_quarantine_retry' | 'sync_queue_quarantine_discard',
    taskId: number,
    action: () => Promise<boolean> | undefined
  ): Promise<boolean> => {
    try {
      await ensureReady();
      const applied = (await action()) === true;
      recordOperationalTelemetry({
        category: 'sync',
        operation,
        status: applied ? 'success' : 'degraded',
        runtimeState: applied ? undefined : 'recoverable',
        issues: applied
          ? []
          : ['La tarea en cuarentena ya no existe o cambió de estado antes de la acción.'],
        context: { taskId },
      });
      return applied;
    } catch (error) {
      logger.warn('Failed to run quarantined task action', error);
      recordReadFailure(`${operation}_failure`, error, { taskId });
      return false;
    }
  };

  const retryQuarantinedSyncTask = async (taskId: number): Promise<boolean> => {
    const applied = await runAction('sync_queue_quarantine_retry', taskId, () =>
      store.requeueQuarantinedTask?.(taskId, getOwnerKey())
    );
    if (applied) triggerProcessing();
    return applied;
  };

  const discardQuarantinedSyncTask = (taskId: number): Promise<boolean> =>
    runAction('sync_queue_quarantine_discard', taskId, () =>
      store.discardQuarantinedTask?.(taskId, getOwnerKey())
    );

  return { retryQuarantinedSyncTask, discardQuarantinedSyncTask };
};
