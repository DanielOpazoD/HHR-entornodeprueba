import type {
  CudyrRecoveryDetail,
  RayenSyncCoverage,
  RayenSyncEvent,
  RayenSyncFailureReason,
  RayenSyncStatus,
  RayenSyncCoverageIssue,
  RayenSyncStructuralIssue,
  RayenSyncStructuralReviewEvidence,
} from '@/types/domain/rayenSync';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
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
    timeZone: CLINICAL_TIME_ZONE,
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

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
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
  const pending = coverage.errors > 0;
  const sourcePartial = coverage.sourceErrors > 0;
  return {
    label: `${coverage.completed}/${coverage.total}${
      pending
        ? ` · ${plural(coverage.errors, 'pendiente')}`
        : sourcePartial
          ? ' · fuente parcial'
          : ' completa'
    }`,
    tone: pending || sourcePartial ? 'warning' : 'success',
  };
};

export const presentRayenLegacyCoverageGap = (coverage: RayenSyncCoverage): string => {
  const gaps: string[] = [];
  if (coverage.errors > 0) {
    gaps.push(`${plural(coverage.errors, 'paciente')} con información clínica incompleta`);
  }
  if (coverage.sourceErrors > 0) {
    gaps.push(`${plural(coverage.sourceErrors, 'falla')} de fuente`);
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

const failureReasonLabel: Record<RayenSyncFailureReason, string> = {
  extension_unavailable: 'Extensión no disponible',
  extension_incompatible: 'Extensión incompatible',
  ficha_medico_unavailable: 'Ficha Médico no disponible',
  ficha_medico_stale: 'Ficha Médico: lector bloqueado o desactualizado',
  gestion_camas_unavailable: 'Gestión de Camas no disponible',
  snapshot_network_error: 'Problema de conexión al leer Eloísa',
  snapshot_timeout: 'Tiempo de espera al capturar Eloísa',
  snapshot_error: 'No se pudo leer Eloísa',
  apply_unauthorized: 'Sesión sin permisos para guardar',
  apply_conflict: 'El censo cambió durante el guardado',
  apply_failed: 'No se pudo aplicar el censo',
};
export const rayenFailureReasonLabel = (reason?: RayenSyncFailureReason): string =>
  reason && Object.hasOwn(failureReasonLabel, reason)
    ? failureReasonLabel[reason]
    : failureReasonLabel.extension_unavailable;

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

const unappliedChanges = (count: number): string =>
  `${plural(count, 'cambio')} del censo no se ${count === 1 ? 'aplicó' : 'aplicaron'}`;

export const presentRayenStructuralReviewSummary = (
  review?: RayenSyncStructuralReviewEvidence
): string[] => {
  if (!review) return [];
  const reasons: string[] = [];
  if (review.isolatedConflicts > 0) {
    reasons.push(unappliedChanges(review.isolatedConflicts));
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
  'previous-census-continuity':
    'un paciente del censo previo no tiene continuidad ni salida explicada',
  'historical-reconstruction': 'la reconstrucción histórica requiere revisión',
  'historical-admission-evidence': 'no se confirmó la cama de una corrección nocturna',
  'unverified-report-row': 'un alta del informe de GC no se vinculó a un episodio exacto',
  'episode-less-report-row': 'una fila del informe de GC no identifica el episodio activo',
  'report-predates-admission': 'un egreso del informe de GC es anterior al ingreso activo',
  'crib-conflict-blocks-discharge': 'el alta no se aplicó: la cuna de la cama tiene un conflicto',
  'admission-date-policy': 'la validación rechazó un cambio en la fecha de ingreso',
  'structural-write-rejected': 'el guardado del censo no pudo confirmarse',
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
      `${unappliedChanges(unclassifiedCount)}; esta ejecución anterior no conservó la cama y la causa.`
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
  const reasons = presentRayenStructuralReviewSummary(event.structuralReview);
  if (event.coverage?.errors) {
    reasons.push(`${plural(event.coverage.errors, 'paciente')} no se pudo completar`);
  }
  const issues = event.coverage?.issues ?? [];
  if (
    event.coverage?.sourceErrors &&
    (!issues.length ||
      issues.some(
        issue => issue.reason === 'source_unavailable' || issue.reason === 'source_timeout'
      ))
  ) {
    reasons.push('Fuente clínica incompleta');
  }
  if (issues.some(issue => issue.reason === 'record_load_failed'))
    reasons.push('No se pudo cargar el censo HHR');
  if (event.source?.gestionCamas && event.source.gestionCamas !== 'ready') {
    reasons.push('Gestión de Camas no disponible');
  }
  return reasons;
};

const unable = (action: string): string => `no se pudo ${action}`;
const retryConnection = (detail: string): string => `${detail}; comprueba la conexión y reintenta`;
const issueSourceLabel: Record<RayenSyncCoverageIssue['source'], string> = {
  census: 'Carga del censo HHR',
  devices: 'Dispositivos',
  scales: 'Escalas de riesgo',
  vitals: 'Signos vitales',
  staffing: 'Enfermería / TENS',
  cudyr: 'CUDYR',
  bed_history: 'Movimientos de camas',
  patch: 'Guardado del censo',
};

const issueReasonLabel: Record<
  RayenSyncCoverageIssue['reason'] | CudyrRecoveryDetail['kind'],
  string
> = {
  concurrent_write: 'el censo cambió mientras se guardaba; reintenta para completar este dato',
  source_unavailable: unable('leer esta información; comprueba la ficha y reintenta'),
  source_timeout: retryConnection('la fuente demoró demasiado'),
  historical_archive_failed: 'recuperación histórica del CUDYR pendiente; revisa y reintenta',
  historical_census_write_failed:
    'las correcciones de días previos quedaron pendientes; reintenta la sincronización',
  structural_conflict:
    'la estructura de este episodio requiere revisión; los demás pacientes sí continuaron',
  sync_already_running: 'ya había otra sincronización clínica en curso; espera y reintenta',
  record_load_failed: unable(retryConnection('cargar el censo actual')),
  write_failed: unable(retryConnection('confirmar el guardado')),
  unexpected: 'ocurrió un error no esperado; reintenta y revisa el nuevo detalle',

  read_failed: unable('consultar el informe; reintenta'),
  attribution_unreliable: unable('atribuir al episodio; revisa la fuente'),
  documentary_inconclusive: unable('recuperar una categoría; revisa la noche'),
  archive_unconfirmed: unable('confirmar el respaldo documental; reintenta'),
};

export const presentRayenCoverageIssue = (issue: RayenSyncCoverageIssue): string => {
  const scope = issue.bedId === '*' ? 'General' : `Cama ${issue.bedId}`;
  const detail = issue.source === 'cudyr' ? issue.cudyrRecovery : undefined;
  const label =
    detail?.kind === 'read_failed' &&
    (issue.reason === 'record_load_failed' || detail.targetDate === null)
      ? 'contexto censal sin comprobar; reintenta'
      : issueReasonLabel[detail?.kind ?? issue.reason];
  return `${scope} · ${issueSourceLabel[issue.source]}: ${label}.`;
};

export const presentRayenSyncOutcome = (event: RayenSyncEvent): RayenSyncOutcomePresentation => {
  const status = event.status;
  const complete = status === 'complete';
  return {
    label: rayenSyncStatusLabel(status) ?? 'Parcial',
    detail: complete
      ? null
      : status === 'failed'
        ? rayenFailureReasonLabel(event.failureReason)
        : status === 'applied'
          ? 'Enriquecimiento clínico pendiente'
          : partialReasons(event).join(' · ') || 'Enriquecimiento clínico parcial',
    tone: complete
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : status === 'applied'
          ? 'info'
          : 'warning',
    unresolved: !complete,
  };
};
