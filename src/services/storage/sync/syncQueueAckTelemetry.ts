import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

const toSyncIssueMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;

export const recordSyncQueueAckFailure = (
  record: DailyRecord,
  syncContract: SyncTask['syncContract'] | undefined,
  error: unknown
): void => {
  recordOperationalTelemetry({
    category: 'sync',
    operation: 'sync_queue_ack_failure',
    status: 'degraded',
    runtimeState: 'recoverable',
    issues: [
      toSyncIssueMessage(
        error,
        'La cola de sincronizacion no pudo confirmar una tarea ya sincronizada.'
      ),
    ],
    context: {
      type: 'UPDATE_DAILY_RECORD',
      date: record.date,
      mutationId: syncContract?.mutationId,
    },
  });
};
