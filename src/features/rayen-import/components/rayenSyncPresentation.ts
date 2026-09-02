import type {
  RayenSyncCoverage,
  RayenSyncEvent,
  RayenSyncFailureReason,
  RayenSyncStatus,
  RayenSyncCoverageIssue,
  RayenSyncStructuralIssue,
  RayenSyncStructuralReviewEvidence,
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

export const presentRayenLegacyCoverageGap = (coverage: RayenSyncCoverage): string => {
  const gaps: string[] = [];
  if (coverage.errors > 0) {
    gaps.push(
      `${coverage.errors} paciente${coverage.errors === 1 ? '' : 's'} con información clínica incompleta`
    );
  }
  if (coverage.sourceErrors > 0) {
    gaps.push(`${coverage.sourceErrors} falla${coverage.sourceErrors === 1 ? '' : 's'} de fuente`);
  }
  const summary = gaps.join(' y ') || 'información clínica incompleta';
  return `Esta ejecución anterior registró ${summary}, pero no conservó la cama ni la etapa. Al reintentar, una nueva ejecución mostrará cama, fuente y causa si vuelve a ocurrir.`;
};

export const rayenPrimaryActionLabel = (
  connection: RayenExtensionConnectionState,
  syncing: boolean
): string => {
  if (syncing) return 'Sincronizando…';
  if (connection === 'checking') return 'Comprobando…';
  // Botón honesto: cuando no es factible, el botón queda DESHABILITADO con la
  // razón en el title y las acciones viven en el monitor de conexiones; la
  // etiqueta ya no muta a un llamado a la acción que el clic no cumple.
  return 'Sincronizar';
};

export const rayenFailureReasonLabel = (reason?: RayenSyncFailureReason): string => {
  if (reason === 'extension_incompatible') return 'Extensión incompatible';
  if (reason === 'ficha_medico_unavailable') return 'Ficha Médico no disponible';
  if (reason === 'ficha_medico_stale') return 'Ficha Médico inactiva: recargar la pestaña';
  if (reason === 'gestion_camas_unavailable') return 'Gestión de Camas no disponible';
  if (reason === 'snapshot_timeout') return 'Sin respuesta de la extensión';
  if (reason === 'snapshot_error') return 'No se pudo leer Eloísa';
  if (reason === 'apply_unauthorized') return 'Sesión sin permisos para guardar';
  if (reason === 'apply_conflict') return 'El censo cambió durante el guardado';
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

export const presentRayenStructuralReviewSummary = (
  review?: RayenSyncStructuralReviewEvidence
): string[] => {
  if (!review) return [];
  const reasons: string[] = [];
  if (review.isolatedConflicts > 0) {
    reasons.push(
      `${review.isolatedConflicts} cambio${review.isolatedConflicts === 1 ? '' : 's'} del censo no se ${review.isolatedConflicts === 1 ? 'aplicó' : 'aplicaron'}`
    );
  }
  if (review.historicalCorrectionsPending) {
    reasons.push('Correcciones históricas pendientes de confirmación');
  }
  if (review.historicalCorrectionsRequireFreshCapture) {
    reasons.push('Una corrección histórica requiere una nueva captura');
  }
  return reasons;
};

const structuralIssueReasonLabel: Record<RayenSyncStructuralIssue['reason'], string> = {
  'unconfirmed-principal-bed': 'no se confirmó la cama física del ingreso',
  'principal-bed-collision': 'dos episodios compiten por la misma cama',
  'cma-physical-bed-collision': 'la cama física asociada a CMA requiere una decisión',
  'occupied-local-bed': 'la cama está ocupada por otro paciente en HHR',
  'historical-reconstruction': 'la reconstrucción histórica requiere revisión',
  'historical-admission-evidence': 'no se confirmó la cama de una corrección nocturna',
  unclassified: 'el cambio estructural no pudo aplicarse',
};

export const presentRayenStructuralIssue = (issue: RayenSyncStructuralIssue): string => {
  const scope = issue.bedId ? `Cama ${issue.bedId}` : 'Censo';
  return `${scope}: ${structuralIssueReasonLabel[issue.reason]}.`;
};

export const presentRayenStructuralReviewDetails = (
  review?: RayenSyncStructuralReviewEvidence
): string[] => {
  if (!review) return [];
  const details = (review.issues ?? []).map(presentRayenStructuralIssue);
  const unclassifiedCount = Math.max(review.isolatedConflicts - details.length, 0);
  if (unclassifiedCount > 0) {
    details.push(
      `${unclassifiedCount} cambio${unclassifiedCount === 1 ? '' : 's'} del censo no se ${unclassifiedCount === 1 ? 'aplicó' : 'aplicaron'}; esta ejecución anterior no conservó la cama y la causa.`
    );
  }
  if (review.historicalCorrectionsPending) {
    details.push(
      'Hay correcciones de días previos guardadas en cola y pendientes de confirmación.'
    );
  }
  if (review.historicalCorrectionsRequireFreshCapture) {
    details.push('Una corrección de un día previo debe recalcularse con una nueva sincronización.');
  }
  return details;
};

export const presentRayenDeferredHistoricalAdmissionNote = (
  review?: RayenSyncStructuralReviewEvidence
): string | null => {
  const beds = review?.deferredHistoricalAdmissionBedIds ?? [];
  if (beds.length === 0) return null;
  const bedLabel = beds.length === 1 ? `la cama ${beds[0]}` : `las camas ${beds.join(', ')}`;
  const placementLabel = beds.length === 1 ? 'esa ubicación' : 'esas ubicaciones';
  return `El ingreso del día actual quedó sincronizado. HHR no modificó el día previo para ${bedLabel} porque Eloísa no permitió confirmar ${placementLabel}. Al volver a sincronizar, HHR lo comprobará nuevamente.`;
};

const partialReasons = (event: RayenSyncEvent): string[] => {
  const reasons: string[] = [];
  reasons.push(...presentRayenStructuralReviewSummary(event.structuralReview));
  if (event.coverage?.errors) {
    reasons.push(
      `${event.coverage.errors} paciente${event.coverage.errors === 1 ? '' : 's'} no se pudo completar`
    );
  }
  const recordedSourceIssue = event.coverage?.issues?.some(
    issue => issue.reason === 'source_unavailable' || issue.reason === 'source_timeout'
  );
  const recordLoadFailed = event.coverage?.issues?.some(
    issue => issue.reason === 'record_load_failed'
  );
  const hasStructuredIssues = Boolean(event.coverage?.issues?.length);
  if (event.coverage?.sourceErrors && (recordedSourceIssue === true || !hasStructuredIssues)) {
    reasons.push('Fuente clínica incompleta');
  }
  if (recordLoadFailed) reasons.push('No se pudo cargar el censo HHR');
  if (event.source?.gestionCamas && event.source.gestionCamas !== 'ready') {
    reasons.push('Gestión de Camas no disponible');
  }
  return reasons;
};

const issueSourceLabel: Record<RayenSyncCoverageIssue['source'], string> = {
  census: 'Carga del censo HHR',
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
  historical_census_write_failed:
    'las correcciones de días previos quedaron pendientes; reintenta la sincronización',
  structural_conflict:
    'la estructura de este episodio requiere revisión; los demás pacientes sí continuaron',
  sync_already_running: 'ya había otra sincronización clínica en curso; espera y reintenta',
  record_load_failed: 'no se pudo cargar el censo actual; comprueba la conexión y reintenta',
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
  action: 'refresh' | 'retry_full' | 'retry_clinical' | null;
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

  // Permisos antes que conexión: con Eloísa sana el banner ofrecía «Revisar
  // censo», un reintento que vuelve a fallar porque el problema no está en la
  // extensión ni en el servidor, sino en la sesión (visto en vivo el 01-09).
  if (event.failureReason === 'apply_unauthorized') {
    return {
      title: 'Sesión sin permisos',
      detail:
        'El censo se capturó pero no se pudo guardar: tu sesión perdió permisos. Vuelve a iniciar sesión y sincroniza de nuevo.',
      action: null,
      actionLabel: null,
      tone: 'warning',
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
      title: 'Ficha Médico quedó inactiva',
      detail:
        'Eloísa respondió, pero la pestaña de Ficha Médico ya no puede leer datos (sesión de red vencida o pestaña envejecida). Recárgala (Cmd+R), espera a que cargue y luego pulsa «Revisar censo».',
      action: 'retry_full',
      actionLabel: 'Revisar censo',
      tone: 'warning',
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
    const clinicalOnly = !structuralReviewPending && structureConfirmed;
    return {
      title: clinicalOnly ? 'Información clínica pendiente' : 'Censo pendiente de revisión',
      detail: clinicalOnly
        ? 'El censo ya está confirmado. Puedes completar solamente los datos clínicos pendientes.'
        : `${outcome.detail ?? 'La ejecución quedó pendiente'}. Eloísa está operativa.`,
      action: clinicalOnly ? 'retry_clinical' : 'retry_full',
      actionLabel: clinicalOnly ? 'Reintentar información clínica' : 'Revisar censo',
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
