import type {
  RayenSyncCoverage,
  RayenSyncEvent,
  RayenSyncFailureReason,
  RayenSyncStatus,
  RayenSyncCoverageIssue,
} from '@/types/domain/rayenSync';
import type { RayenExtensionConnectionState } from '../hooks/useRayenExtensionHealth';

export interface CoveragePresentation {
  label: string;
  tone: 'muted' | 'success' | 'warning';
}

export const formatRayenSyncTargetDate = (value?: string | null): string => {
  if (!value) return 'hoy';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}-${month}-${year}` : value;
};

export const formatRayenSyncIslandTime = (iso: string): string => {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return 'Hora no disponible';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'Pacific/Easter',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
};

export const formatRayenSyncDuration = (startedAt: string, completedAt?: string): string | null => {
  if (!completedAt) return null;
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return null;

  const seconds = Math.max(1, Math.round((completed - started) / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60)
    return remainingSeconds ? `${minutes} min ${remainingSeconds} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
};

export const presentRayenCoverage = (
  coverage: RayenSyncCoverage | undefined,
  hasSync: boolean,
  enrichmentPending = false
): CoveragePresentation => {
  if (!coverage) {
    if (enrichmentPending) return { label: 'Enriquecimiento pendiente', tone: 'warning' };
    return hasSync
      ? { label: 'No disponible en sincronizaciones antiguas', tone: 'muted' }
      : { label: 'Sin sincronización', tone: 'muted' };
  }
  if (coverage.total === 0) return { label: 'Sin cobertura clínica', tone: 'muted' };
  if (coverage.errors > 0) {
    return {
      label: `${coverage.completed}/${coverage.total} · ${coverage.errors} pendiente${coverage.errors === 1 ? '' : 's'}`,
      tone: 'warning',
    };
  }
  if (coverage.sourceErrors > 0) {
    return { label: `${coverage.completed}/${coverage.total} · fuente parcial`, tone: 'warning' };
  }
  return { label: `${coverage.completed}/${coverage.total} completa`, tone: 'success' };
};

export const rayenPrimaryActionLabel = (
  connection: RayenExtensionConnectionState,
  syncing: boolean
): string => {
  if (syncing) return 'Sincronizando…';
  if (connection === 'checking') return 'Comprobando…';
  if (connection === 'ready') return 'Sincronizar';
  if (connection === 'degraded' || connection === 'blocked') return 'Revisar conexión';
  if (connection === 'incompatible') return 'Actualizar extensión';
  return 'Comprobar conexión';
};

export const rayenFailureReasonLabel = (reason?: RayenSyncFailureReason): string => {
  if (reason === 'extension_incompatible') return 'Extensión incompatible';
  if (reason === 'ficha_medico_unavailable') return 'Ficha Médico no disponible';
  if (reason === 'gestion_camas_unavailable') return 'Gestión de Camas no disponible';
  if (reason === 'snapshot_timeout') return 'Sin respuesta de la extensión';
  if (reason === 'snapshot_error') return 'No se pudo leer Eloísa';
  if (reason === 'apply_failed') return 'No se pudo aplicar el censo';
  return 'Extensión no disponible';
};

export type RayenSyncOutcomeTone = 'success' | 'warning' | 'danger' | 'info';

export interface RayenSyncOutcomePresentation {
  label: string;
  detail: string | null;
  tone: RayenSyncOutcomeTone;
  unresolved: boolean;
}

export const rayenSyncStatusLabel = (status?: RayenSyncStatus): string | null => {
  if (status === 'complete') return 'Completa';
  if (status === 'partial') return 'Parcial';
  if (status === 'applied') return 'Censo aplicado';
  if (status === 'failed') return 'Fallida';
  return null;
};

const partialReasons = (event: RayenSyncEvent): string[] => {
  const reasons: string[] = [];
  if (event.coverage?.errors) {
    reasons.push(
      `${event.coverage.errors} paciente${event.coverage.errors === 1 ? '' : 's'} no se pudo completar`
    );
  }
  const recordedSourceIssue = event.coverage?.issues?.some(
    issue => issue.reason === 'source_unavailable' || issue.reason === 'source_timeout'
  );
  const hasStructuredIssues = Boolean(event.coverage?.issues?.length);
  if (event.coverage?.sourceErrors && (recordedSourceIssue === true || !hasStructuredIssues)) {
    reasons.push('Fuente clínica incompleta');
  }
  if (event.source?.gestionCamas && event.source.gestionCamas !== 'ready') {
    reasons.push('Gestión de Camas no disponible');
  }
  return reasons;
};

const issueSourceLabel: Record<RayenSyncCoverageIssue['source'], string> = {
  devices: 'Dispositivos',
  scales: 'Escalas de riesgo',
  vitals: 'Signos vitales',
  staffing: 'Enfermería / TENS',
  cudyr: 'CUDYR',
  patch: 'Guardado del censo',
};

const issueReasonLabel: Record<RayenSyncCoverageIssue['reason'], string> = {
  concurrent_write: 'el censo cambió mientras se guardaba; reintenta para completar este dato',
  source_unavailable: 'Eloísa no devolvió esta información; comprueba la ficha y reintenta',
  source_timeout: 'la fuente demoró demasiado; comprueba la conexión y reintenta',
  historical_archive_failed: 'no se pudo asociar el CUDYR al turno correcto; reintenta',
  sync_already_running: 'ya había otra sincronización clínica en curso; espera y reintenta',
  write_failed: 'no se pudo confirmar el guardado; comprueba la conexión y reintenta',
  unexpected: 'ocurrió un error no esperado; reintenta y revisa el nuevo detalle',
};

export const presentRayenCoverageIssue = (issue: RayenSyncCoverageIssue): string => {
  const scope = issue.bedId === '*' ? 'General' : `Cama ${issue.bedId}`;
  return `${scope} · ${issueSourceLabel[issue.source]}: ${issueReasonLabel[issue.reason]}.`;
};

export const presentRayenSyncOutcome = (event: RayenSyncEvent): RayenSyncOutcomePresentation => {
  const label = rayenSyncStatusLabel(event.status) ?? 'Parcial';
  if (event.status === 'complete') {
    return { label, detail: null, tone: 'success', unresolved: false };
  }
  if (event.status === 'failed') {
    return {
      label,
      detail: rayenFailureReasonLabel(event.failureReason),
      tone: 'danger',
      unresolved: true,
    };
  }
  if (event.status === 'applied') {
    return {
      label,
      detail: 'Enriquecimiento clínico pendiente',
      tone: 'info',
      unresolved: true,
    };
  }
  const reasons = partialReasons(event);
  return {
    label,
    detail: reasons.join(' · ') || 'Enriquecimiento clínico parcial',
    tone: 'warning',
    unresolved: true,
  };
};

export interface RayenSyncRecoveryPresentation {
  title: string;
  detail: string;
  action: 'refresh' | 'retry' | null;
  actionLabel: string | null;
  tone: 'warning' | 'danger' | 'info';
}

export const presentRayenSyncRecovery = (
  event: RayenSyncEvent | undefined,
  connection: RayenExtensionConnectionState,
  synchronizationRunning = false
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
      tone: 'info',
    };
  }

  if (connection === 'checking') {
    return {
      title: 'Comprobando conexión',
      detail: outcome.detail ?? 'Validando si Eloísa está disponible.',
      action: null,
      actionLabel: null,
      tone: 'info',
    };
  }
  if (connection === 'ready') {
    return {
      title: 'Puedes completar esta sincronización',
      detail: `${outcome.detail ?? 'La ejecución quedó pendiente'}. Eloísa está operativa.`,
      action: 'retry',
      actionLabel: 'Reintentar con revisión',
      tone: 'warning',
    };
  }

  const title =
    connection === 'blocked'
      ? 'Ficha Médico requiere atención'
      : connection === 'incompatible'
        ? 'La extensión debe actualizarse'
        : connection === 'degraded'
          ? 'La conexión sigue parcial'
          : 'Eloísa no responde';
  return {
    title,
    detail: outcome.detail ?? 'La ejecución no se completó.',
    action: 'refresh',
    actionLabel: 'Comprobar nuevamente',
    tone: connection === 'blocked' || connection === 'incompatible' ? 'danger' : 'warning',
  };
};
