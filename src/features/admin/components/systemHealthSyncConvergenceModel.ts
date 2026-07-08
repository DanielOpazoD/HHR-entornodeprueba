import type { UserHealthRecentEvent, UserHealthStatus } from '@/services/admin/healthService';

export type SystemHealthSyncConvergencePanelStatus =
  | 'healthy'
  | 'recoverable'
  | 'needs_review'
  | 'unsafe';

export interface SystemHealthSyncConvergencePanelModel {
  status: SystemHealthSyncConvergencePanelStatus;
  statusLabel: string;
  summary: string;
  pendingOperations: number;
  blockedOperations: number;
  recoverableDivergences: number;
  affectedUsers: number;
  operatorActions: string[];
  clinicalSignals: Array<{
    label: string;
    count: number;
    examples: string[];
  }>;
  lastConvergenceOkAt?: string;
  technicalDetails: string[];
}

const TRUTH_SELECTION_OPERATION = 'sync_queue_truth_selected';

const STATUS_LABELS: Record<SystemHealthSyncConvergencePanelStatus, string> = {
  healthy: 'Convergente',
  recoverable: 'Con recuperación pendiente',
  needs_review: 'Requiere revisión',
  unsafe: 'Inseguro',
};

const toMs = (timestamp: string | undefined): number => {
  if (!timestamp) return 0;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
};

const isSyncEvent = (event: UserHealthRecentEvent): boolean => event.category === 'sync';

const isTruthSelectionOkEvent = (event: UserHealthRecentEvent): boolean =>
  isSyncEvent(event) &&
  event.operation === TRUTH_SELECTION_OPERATION &&
  event.status === 'recovered' &&
  event.telemetryStatus === 'success';

const isRecoverableSyncDivergenceEvent = (event: UserHealthRecentEvent): boolean =>
  isSyncEvent(event) &&
  event.status === 'recovered' &&
  event.operation !== TRUTH_SELECTION_OPERATION;

const buildSummary = ({
  status,
  pendingOperations,
  blockedOperations,
  recoverableDivergences,
  affectedUsers,
}: Pick<
  SystemHealthSyncConvergencePanelModel,
  'affectedUsers' | 'blockedOperations' | 'pendingOperations' | 'recoverableDivergences' | 'status'
>): string => {
  if (status === 'healthy') {
    return affectedUsers === 0
      ? 'Sin usuarios con actividad de sincronizacion visible en los filtros actuales.'
      : 'Sin pendientes ni conflictos de sincronización visibles en los filtros actuales.';
  }

  const fragments: string[] = [];
  if (blockedOperations > 0) {
    fragments.push(`${blockedOperations} operaciones fallidas/en conflicto`);
  }
  if (pendingOperations > 0) {
    fragments.push(`${pendingOperations} operaciones pendientes/reintentando`);
  }
  if (recoverableDivergences > 0) {
    fragments.push(`${recoverableDivergences} divergencias recuperables recientes`);
  }

  return fragments.join('; ');
};

const normalizeSignalLabel = (event: UserHealthRecentEvent): string => {
  const raw = `${event.module || event.operation || 'Sincronización'}`.toLowerCase();
  if (/m[eé]dic|medical/.test(raw)) return 'Entrega médica';
  if (/enfermer|nursing|handoff/.test(raw)) return 'Entrega enfermería';
  if (/censo|census|daily/.test(raw)) return 'Censo diario';
  if (/snapshot|recover/.test(raw)) return 'Recuperación';
  return event.module || 'Sincronización local';
};

const buildClinicalSignals = (
  users: UserHealthStatus[]
): SystemHealthSyncConvergencePanelModel['clinicalSignals'] => {
  const byLabel = new Map<string, string[]>();
  users.forEach(user => {
    (user.recentEvents || []).filter(isSyncEvent).forEach(event => {
      const label = normalizeSignalLabel(event);
      const context = (event.contextSummary || []).join(' · ');
      const example = [user.displayName, event.message, context].filter(Boolean).join(' · ');
      const examples = byLabel.get(label) || [];
      examples.push(example);
      byLabel.set(label, examples);
    });
  });

  return Array.from(byLabel.entries()).map(([label, examples]) => ({
    label,
    count: examples.length,
    examples: examples.slice(0, 2),
  }));
};

const buildOperatorActions = ({
  status,
  pendingOperations,
  blockedOperations,
  recoverableDivergences,
}: Pick<
  SystemHealthSyncConvergencePanelModel,
  'blockedOperations' | 'pendingOperations' | 'recoverableDivergences' | 'status'
>): string[] => {
  if (status === 'healthy') {
    return ['No se requieren acciones de sincronización clínica.'];
  }

  const actions: string[] = [];
  if (pendingOperations > 0) {
    actions.push('Acción segura: reintentar cola local o esperar drenaje de outbox.');
  }
  if (recoverableDivergences > 0) {
    actions.push('Refrescar remoto y confirmar si la mutación ya fue aplicada.');
  }
  if (blockedOperations > 0 || status === 'needs_review') {
    actions.push('abrir centro de conflictos clínicos y revisar contexto antes de preservar.');
  }
  if (status === 'unsafe') {
    actions.push('No autorresolver: bloquear y escalar revisión clínica/soporte.');
  }
  return actions;
};

export const buildSystemHealthSyncConvergencePanelModel = (
  users: UserHealthStatus[]
): SystemHealthSyncConvergencePanelModel => {
  const pendingOperations = users.reduce(
    (total, user) => total + user.pendingSyncTasks + user.retryingSyncTasks,
    0
  );
  const blockedOperations = users.reduce(
    (total, user) =>
      total + user.failedSyncTasks + user.conflictSyncTasks + (user.syncOrphanedTasks || 0),
    0
  );
  const syncEvents = users.flatMap(user => user.recentEvents?.filter(isSyncEvent) || []);
  const recoverableDivergences = syncEvents.filter(isRecoverableSyncDivergenceEvent).length;
  const clinicalSignals = buildClinicalSignals(users);
  const lastConvergenceOkAt = syncEvents
    .filter(isTruthSelectionOkEvent)
    .sort((left, right) => toMs(right.timestamp) - toMs(left.timestamp))[0]?.timestamp;
  const affectedUsers = users.filter(user => {
    const hasSyncWork =
      user.pendingSyncTasks +
        user.retryingSyncTasks +
        user.failedSyncTasks +
        user.conflictSyncTasks +
        (user.syncOrphanedTasks || 0) >
      0;
    return hasSyncWork || (user.recentEvents || []).some(isSyncEvent);
  }).length;

  const hasUnsafeSignal = syncEvents.some(
    event =>
      event.severity === 'critical' &&
      event.runtimeState === 'blocked' &&
      /invariant|duplicate|unsafe/i.test(`${event.operation || ''} ${event.message || ''}`)
  );
  const status: SystemHealthSyncConvergencePanelStatus = hasUnsafeSignal
    ? 'unsafe'
    : blockedOperations > 0
      ? 'needs_review'
      : pendingOperations > 0 || recoverableDivergences > 0
        ? 'recoverable'
        : 'healthy';

  const technicalDetails = users
    .flatMap(user => {
      const details: string[] = [];
      if (user.pendingSyncTasks > 0 || user.retryingSyncTasks > 0) {
        details.push(
          `${user.displayName}: ${user.pendingSyncTasks} pendientes, ${user.retryingSyncTasks} reintentando`
        );
      }
      if (
        user.failedSyncTasks > 0 ||
        user.conflictSyncTasks > 0 ||
        (user.syncOrphanedTasks || 0) > 0
      ) {
        details.push(
          `${user.displayName}: ${user.failedSyncTasks} fallidas, ${user.conflictSyncTasks} en conflicto, ${user.syncOrphanedTasks || 0} huérfanas`
        );
      }
      (user.recentEvents || []).filter(isRecoverableSyncDivergenceEvent).forEach(event => {
        details.push(
          `Operación recuperable: ${event.operation || 'sync'} en ${event.module || 'Sync'}`
        );
      });
      return details;
    })
    .slice(0, 8);

  if (lastConvergenceOkAt) {
    technicalDetails.push(`Última verdad aceptada: ${lastConvergenceOkAt}`);
  }

  return {
    status,
    statusLabel: STATUS_LABELS[status],
    summary: buildSummary({
      status,
      pendingOperations,
      blockedOperations,
      recoverableDivergences,
      affectedUsers,
    }),
    pendingOperations,
    blockedOperations,
    recoverableDivergences,
    affectedUsers,
    operatorActions: buildOperatorActions({
      status,
      pendingOperations,
      blockedOperations,
      recoverableDivergences,
    }),
    clinicalSignals,
    lastConvergenceOkAt,
    technicalDetails,
  };
};
