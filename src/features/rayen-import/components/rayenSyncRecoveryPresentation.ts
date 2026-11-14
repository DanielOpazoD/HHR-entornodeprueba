import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import type { RayenExtensionConnectionState } from '../hooks/useRayenExtensionHealth';
import { presentRayenSyncOutcome } from './rayenSyncPresentation';
import type { SyncToneLevel } from './syncTone';

export interface RayenSyncRecoveryPresentation {
  title: string;
  detail: string;
  action: 'refresh' | 'retry_full' | 'retry_clinical' | null;
  actionLabel: string | null;
  /** A failed Eloísa read loses no edit: recovery is informative or something to review. */
  level: Exclude<SyncToneLevel, 'action'>;
}

export const presentRayenSyncRecovery = (
  event: RayenSyncEvent | undefined,
  connection: RayenExtensionConnectionState,
  synchronizationRunning = false,
  clinicalRetryAvailable = false
): RayenSyncRecoveryPresentation | null => {
  if (!event) return null;
  const outcome = presentRayenSyncOutcome(event);
  if (!outcome.unresolved) return null;

  if (synchronizationRunning) {
    return {
      title: 'Sincronización en curso',
      detail: outcome.detail ?? 'Completando la ejecución actual.',
      action: null,
      actionLabel: null,
      level: 'info',
    };
  }

  if (connection === 'checking') {
    return {
      title: 'Comprobando conexión',
      detail: outcome.detail ?? 'Validando si Eloísa está disponible.',
      action: null,
      actionLabel: null,
      level: 'info',
    };
  }

  // Permisos antes que conexión: con Eloísa sana el banner ofrecía «Revisar
  // censo», un reintento que vuelve a fallar porque el problema no está en la
  // extensión ni en el servidor, sino en la sesión (visto en vivo el 01-09).
  if (event.failureReason === 'apply_unauthorized') {
    return {
      title: 'Vuelve a iniciar sesión',
      detail:
        'La lectura de Eloísa todavía no se guardó porque la sesión ya no tiene permiso. Inicia sesión de nuevo y vuelve a sincronizar.',
      action: null,
      actionLabel: null,
      level: 'review',
    };
  }
  // Otra pestaña o usuario guardó el mismo censo mientras se confirmaba (visto
  // en vivo el 02-09 con dos pestañas de HHR): reintentar suele bastar, y si
  // se repite, la causa está en la otra pestaña, no en Eloísa.
  if (event.failureReason === 'apply_conflict' && connection === 'ready') {
    return {
      title: 'Otra pestaña guardó primero',
      detail:
        'Otra pestaña o usuario guardó este censo mientras se confirmaba la sincronización. Vuelve a sincronizar; si se repite, cierra las otras pestañas de HHR con este censo abierto.',
      action: 'retry_full',
      actionLabel: 'Revisar censo',
      level: 'review',
    };
  }
  // La salud dice «lista» pero la pestaña no puede leer: reintentar sin
  // recargarla vuelve a fallar en 1 s (visto en vivo el 02-09). El remedio es
  // la recarga; recién después tiene sentido «Revisar censo». Con la
  // extensión ausente o incompatible manda esa condición, no esta.
  if (
    event.failureReason === 'ficha_medico_stale' &&
    (connection === 'ready' || connection === 'blocked')
  ) {
    return {
      title: 'Recarga Ficha Médico',
      detail:
        'Recarga la pestaña de Ficha Médico (Cmd+R), espera a que cargue y luego pulsa «Revisar censo». Esa pestaña dejó de entregar datos.',
      action: 'retry_full',
      actionLabel: 'Revisar censo',
      level: 'review',
    };
  }
  if (connection === 'ready') {
    const structuralReviewPending = Boolean(
      event.structuralReview &&
      (event.structuralReview.historicalCorrectionsPending ||
        event.structuralReview.historicalCorrectionsRequireFreshCapture ||
        event.structuralReview.isolatedConflicts > 0)
    );
    const structureConfirmed =
      event.status === 'applied' || event.structuralReview?.structureConfirmed === true;
    // Terminal partial runs are immutable. A new capture obtains a new server-authorized run;
    // sending the closed run straight to the clinical writer cannot succeed.
    const clinicalOnly =
      clinicalRetryAvailable && !structuralReviewPending && event.status === 'applied';
    const closedClinicalRun = !structuralReviewPending && structureConfirmed && !clinicalOnly;
    return {
      title:
        clinicalOnly || closedClinicalRun
          ? 'Información clínica pendiente'
          : 'Censo pendiente de revisión',
      detail: clinicalOnly
        ? 'El censo ya está confirmado. Puedes completar solamente los datos clínicos pendientes.'
        : closedClinicalRun
          ? 'Vuelve a sincronizar para completar la información pendiente con una nueva lectura de Eloísa.'
          : `${outcome.detail ?? 'La ejecución quedó pendiente'}. Eloísa está operativa.`,
      action: clinicalOnly ? 'retry_clinical' : 'retry_full',
      actionLabel: clinicalOnly
        ? 'Reintentar información clínica'
        : closedClinicalRun
          ? 'Reintentar sincronización'
          : 'Revisar censo',
      level: 'review',
    };
  }

  const title =
    connection === 'blocked'
      ? 'Revisar Ficha Médico'
      : connection === 'incompatible'
        ? 'Actualizar la extensión'
        : connection === 'degraded'
          ? 'Conexión parcial con Eloísa'
          : 'Esperando respuesta de Eloísa';
  return {
    title,
    detail: outcome.detail ?? 'La sincronización quedó pendiente.',
    action: 'refresh',
    actionLabel: 'Comprobar nuevamente',
    level: 'review',
  };
};
