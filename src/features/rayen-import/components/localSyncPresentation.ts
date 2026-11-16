import { isPolicyBlockedCudyrArchive } from '@/services/storage/sync/cudyrPolicyBlockedRecovery';
import { requiresDailyRecordBaseReview } from '@/services/storage/sync/dailyRecordBaseReview';
import type { SyncQueueOperation, SyncQueueStats } from '@/hooks/useSyncQueueMonitor';
import type { SyncToneLevel } from './syncTone';

/**
 * Evita parpadeos durante guardados normales. El aviso del cuadro Eloísa aparece
 * al envejecer una escritura o ante reintentos, fallos o una lectura no disponible.
 */
export const LOCAL_SYNC_PENDING_VISIBILITY_MS = 10_000;

export const hasLocalSyncAttention = (stats: SyncQueueStats): boolean =>
  stats.failed + stats.conflict > 0 ||
  stats.retrying > 0 ||
  stats.readState === 'unavailable' ||
  stats.recentOperationsReadState === 'unavailable' ||
  (stats.pending > 0 && stats.oldestPendingAgeMs >= LOCAL_SYNC_PENDING_VISIBILITY_MS);

/**
 * How the local save indicator reads, only while `hasLocalSyncAttention` shows it. A stopped send
 * (failed or conflict) does not resume alone, so it is the only case that asks for action
 * (SAVE-01). An unreadable queue is something to check; aging or retrying sends go out by themselves.
 */
export const localSyncAttentionLevel = (stats: SyncQueueStats): SyncToneLevel | null => {
  if (!hasLocalSyncAttention(stats)) return null;
  if (stats.failed + stats.conflict > 0) return 'action';
  if (stats.readState === 'unavailable' || stats.recentOperationsReadState === 'unavailable')
    return 'review';
  return 'info';
};

const CATEGORY_LABELS: Record<string, string> = {
  conflict: 'El censo cambió antes del envío',
  authorization: 'Sin permisos',
  validation: 'El servidor no aceptó este cambio',
  network: 'Sin conexión al enviar',
  unknown: 'Envío detenido',
};

interface QuarantinedOperationTarget {
  id: number;
  targetLabel: string;
  categoryLabel: string;
  code?: string;
  detail?: string;
  canRetire: boolean;
}

export type QuarantinedOperationView = QuarantinedOperationTarget &
  (
    | { recovery: 'review_authorization'; retryGuidance: string }
    | { recovery: 'retry' | 'review_base' | 'discard_detached' }
  );

export const targetLabelFromKey = (
  key: string | undefined,
  type: SyncQueueOperation['type']
): string => {
  if (type === 'ARCHIVE_CUDYR') return 'Archivo CUDYR';
  if (type === 'UPDATE_PATIENT') return 'Datos del paciente';
  // daily:<date>:detached:<task>:[bed, target, documentType, rut, patientName, episode]
  const named = key?.match(/^daily:([^:]*):detached:[^:]*:(.*)$/);
  if (named) {
    let name = 'paciente';
    try {
      name = (JSON.parse(named[2]) as string[])[4] ?? '';
    } catch {
      // Keep the generic label for a malformed key.
    }
    return `Cambios de ${name} · ${named[1].split('-').reverse().join('-')}`;
  }
  const date = key?.startsWith('daily:') ? key.slice('daily:'.length) : null;
  if (!date) return 'Registro del censo';
  const [year, month, day] = date.split('-');
  return year && month && day ? `Censo del ${day}-${month}-${year}` : `Censo del ${date}`;
};

/**
 * Edits detached from a patient who left the bed can never be sent as they are: a retry always
 * fails, so the panel offers a confirmed discard instead.
 */
const resolveQuarantineRecovery = (
  operation: SyncQueueOperation
): QuarantinedOperationView['recovery'] => {
  // A closed session cleared the day these edits were made on: like a write without a known base,
  // they cannot be resent as they are, only reviewed and retired with a backup.
  if (operation.projectionReleased || requiresDailyRecordBaseReview(operation))
    return 'review_base';
  if (operation.status === 'FAILED' && operation.lastErrorCategory === 'authorization')
    return 'review_authorization';
  if (operation.status !== 'CONFLICT') return 'retry';
  return operation.key?.includes(':detached:') ? 'discard_detached' : 'retry';
};

export const listQuarantinedOperations = (
  operations: SyncQueueOperation[]
): QuarantinedOperationView[] =>
  operations
    .filter(operation => operation.status === 'FAILED' || operation.status === 'CONFLICT')
    .filter(operation => typeof operation.id === 'number')
    .map(operation => {
      const recovery = resolveQuarantineRecovery(operation);
      const target = {
        id: operation.id as number,
        code: operation.lastErrorCode,
        detail: operation.error,
        targetLabel: targetLabelFromKey(operation.key, operation.type),
        categoryLabel:
          recovery === 'review_base'
            ? 'Revisar antes de reenviar'
            : isPolicyBlockedCudyrArchive(operation)
              ? 'Autorización anterior'
              : (CATEGORY_LABELS[operation.lastErrorCategory ?? 'unknown'] ?? 'Envío detenido'),
        canRetire:
          operation.type === 'UPDATE_DAILY_RECORD' &&
          /^daily:\d{4}-\d{2}-\d{2}$/.test(operation.key ?? ''),
      };
      if (recovery === 'review_authorization') {
        if (operation.lastErrorCode === 'session_owner_logged_out') {
          return {
            ...target,
            recovery,
            categoryLabel: 'Sesión cerrada',
            retryGuidance:
              'Este envío quedó pendiente al cerrar sesión. Revisa que ingresaste con su cuenta original antes de reenviarlo.',
          };
        }
        const sessionNotValidated = /(?:^|\/)unauthenticated$/.test(operation.lastErrorCode ?? '');
        return {
          ...target,
          recovery,
          categoryLabel: sessionNotValidated ? 'Sesión no validada' : 'Sin permisos',
          retryGuidance: sessionNotValidated
            ? 'El servidor todavía no validó la sesión de este envío. Comprueba tu sesión antes de reenviarlo.'
            : 'El servidor rechazó este envío por permisos. Revisa el acceso de tu cuenta antes de reenviarlo.',
        };
      }
      return { ...target, recovery };
    });
