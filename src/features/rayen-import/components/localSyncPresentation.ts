import { isPolicyBlockedCudyrArchive } from '@/services/storage/sync/cudyrPolicyBlockedRecovery';
import type { SyncQueueOperation, SyncQueueStats } from '@/hooks/useSyncQueueMonitor';

/**
 * Evita parpadeos durante guardados normales. El aviso del cuadro Eloísa aparece
 * al envejecer una escritura o ante reintentos, fallos o una lectura no disponible.
 */
export const LOCAL_SYNC_PENDING_VISIBILITY_MS = 10_000;

export const hasLocalSyncAttention = (stats: SyncQueueStats): boolean =>
  stats.failed + stats.conflict > 0 ||
  stats.retrying > 0 ||
  stats.readState === 'unavailable' ||
  (stats.pending > 0 && stats.oldestPendingAgeMs >= LOCAL_SYNC_PENDING_VISIBILITY_MS);

const CATEGORY_LABELS: Record<string, string> = {
  conflict: 'Conflicto de versiones',
  authorization: 'Sin permisos',
  validation: 'Rechazado por validación',
  network: 'Sin conexión',
  unknown: 'Error desconocido',
};

export interface QuarantinedOperationView {
  id: number;
  targetLabel: string;
  categoryLabel: string;
  code?: string;
  detail?: string;
}

export const targetLabelFromKey = (
  key: string | undefined,
  type: SyncQueueOperation['type']
): string => {
  if (type === 'ARCHIVE_CUDYR') return 'Archivo CUDYR';
  if (type === 'UPDATE_PATIENT') return 'Datos del paciente';
  const date = key?.startsWith('daily:') ? key.slice('daily:'.length) : null;
  if (!date) return 'Registro del censo';
  const [year, month, day] = date.split('-');
  return year && month && day ? `Censo del ${day}-${month}-${year}` : `Censo del ${date}`;
};

export const listQuarantinedOperations = (
  operations: SyncQueueOperation[]
): QuarantinedOperationView[] =>
  operations
    .filter(operation => operation.status === 'FAILED' || operation.status === 'CONFLICT')
    .filter(operation => typeof operation.id === 'number')
    .map(operation => ({
      id: operation.id as number,
      code: operation.lastErrorCode,
      detail: operation.error,
      targetLabel: targetLabelFromKey(operation.key, operation.type),
      categoryLabel: isPolicyBlockedCudyrArchive(operation)
        ? 'Autorización anterior'
        : (CATEGORY_LABELS[operation.lastErrorCategory ?? 'unknown'] ?? 'Error desconocido'),
    }));
