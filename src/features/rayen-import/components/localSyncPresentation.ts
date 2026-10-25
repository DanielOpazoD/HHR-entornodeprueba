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
  refusedHandoff: boolean;
}

export const targetLabelFromKey = (
  key: string | undefined,
  type: SyncQueueOperation['type']
): string => {
  if (type === 'ARCHIVE_CUDYR') return 'Archivo CUDYR';
  if (type === 'UPDATE_PATIENT') return 'Datos del paciente';
  if (type === 'UPDATE_SPECIALIST_HANDOFF') {
    // handoff:<date>:[[bed, target, documentType, rut, patientName, episode], ...]
    const [, date = '', occupants = '[]'] = key?.match(/^handoff:([^:]*):(.*)$/) ?? [];
    let names = 'paciente';
    try {
      names = (JSON.parse(occupants) as string[][]).map(occupant => occupant[4]).join(' y ');
    } catch {
      // Keep the generic label for a malformed key.
    }
    return `Nota de entrega de ${names} · ${date.split('-').reverse().join('-')}`;
  }
  const date = key?.startsWith('daily:') ? key.slice('daily:'.length) : null;
  if (!date) return 'Registro del censo';
  const [year, month, day] = date.split('-');
  return year && month && day ? `Censo del ${day}-${month}-${year}` : `Censo del ${date}`;
};

/** A refused specialist note can never be sent as it is: review its draft or discard it. */
export const isRefusedSpecialistHandoff = (
  operation: Pick<SyncQueueOperation, 'type' | 'status'>
) => operation.type === 'UPDATE_SPECIALIST_HANDOFF' && operation.status === 'CONFLICT';

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
      refusedHandoff: isRefusedSpecialistHandoff(operation),
      categoryLabel: isPolicyBlockedCudyrArchive(operation)
        ? 'Autorización anterior'
        : (CATEGORY_LABELS[operation.lastErrorCategory ?? 'unknown'] ?? 'Error desconocido'),
    }));
