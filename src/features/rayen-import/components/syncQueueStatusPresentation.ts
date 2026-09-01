import type { SyncQueueOperation, SyncQueueStats } from '@/hooks/useSyncQueueMonitor';

/**
 * Presentación del estado de la cola local de escrituras para la barra del
 * censo: convierte los contadores y snapshots de la cola en un modelo de chip
 * y en filas legibles (taxonomía del catálogo de errores en castellano).
 */

export type SyncQueueChipTone = 'hidden' | 'syncing' | 'attention';

export interface SyncQueueChipModel {
  tone: SyncQueueChipTone;
  label: string;
  title: string;
}

/**
 * Una escritura normal vive en la cola unos instantes (pre-outbox hold hasta
 * el ack remoto): mostrar el chip por cada guardado sería puro parpadeo. Solo
 * se anuncia lo pendiente cuando envejece o ya está reintentando.
 */
export const SYNC_QUEUE_CHIP_PENDING_VISIBILITY_MS = 10_000;

export const buildSyncQueueChipModel = (stats: SyncQueueStats): SyncQueueChipModel => {
  const stuck = stats.failed + stats.conflict;
  if (stuck > 0) {
    return {
      tone: 'attention',
      label: `${stuck} sin sincronizar`,
      title:
        'Hay cambios guardados en este equipo que no lograron sincronizarse. Abre el detalle para reintentar o descartar.',
    };
  }
  if (
    stats.pending > 0 &&
    (stats.retrying > 0 || stats.oldestPendingAgeMs >= SYNC_QUEUE_CHIP_PENDING_VISIBILITY_MS)
  ) {
    return {
      tone: 'syncing',
      label: `${stats.pending} por sincronizar`,
      title: 'Cambios guardados en este equipo, en camino al servidor.',
    };
  }
  return { tone: 'hidden', label: '', title: '' };
};

const CATEGORY_LABELS: Record<string, string> = {
  conflict: 'Conflicto de versiones',
  authorization: 'Sin permisos',
  validation: 'Rechazado por validación',
  network: 'Sin conexión',
  unknown: 'Error desconocido',
};

const STATUS_LABELS: Record<string, string> = {
  FAILED: 'Detenido',
  CONFLICT: 'En conflicto',
};

export interface QuarantinedOperationView {
  id: number;
  targetLabel: string;
  statusLabel: string;
  categoryLabel: string;
  actionHint: string | null;
  attemptsLabel: string | null;
}

const targetLabelFromKey = (key: string | undefined): string => {
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
      targetLabel: targetLabelFromKey(operation.key),
      statusLabel: STATUS_LABELS[operation.status] ?? operation.status,
      categoryLabel:
        CATEGORY_LABELS[operation.lastErrorCategory ?? 'unknown'] ?? 'Error desconocido',
      actionHint: operation.lastErrorAction ?? null,
      attemptsLabel: operation.retryCount > 0 ? `${operation.retryCount + 1} intentos` : null,
    }));
