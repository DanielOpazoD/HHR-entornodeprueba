import type {
  SyncConvergenceDiagnostic,
  SyncConvergenceFinding,
  SyncConvergenceStatus,
  SyncSnapshotRecoveryContext,
} from '@/services/observability/syncConvergenceDiagnostics';
import type { SyncQueueOperationSnapshot } from '@/services/storage/sync';

export type SyncRecoveryActionKind =
  | 'retry_outbox'
  | 'refresh_remote'
  | 'restore_snapshot'
  | 'block_for_review'
  | 'mark_already_applied';

export type SyncRecoveryActionSafety = 'safe' | 'requires_confirmation' | 'manual_only';

export interface SyncRecoveryAction {
  action: SyncRecoveryActionKind;
  safety: SyncRecoveryActionSafety;
  target: string;
  reason: string;
  findingType?: SyncConvergenceFinding['type'];
  operationId?: number;
}

export interface PlanSyncRecoveryInput {
  diagnostic: SyncConvergenceDiagnostic;
  recentOperations?: SyncQueueOperationSnapshot[];
  snapshotRecovery?: SyncSnapshotRecoveryContext | null;
}

export interface SyncRecoveryPlan {
  status: Exclude<SyncConvergenceStatus, 'healthy'> | 'healthy';
  summary: string;
  actions: SyncRecoveryAction[];
}

const ACTION_ORDER: Record<SyncRecoveryActionKind, number> = {
  retry_outbox: 10,
  mark_already_applied: 15,
  refresh_remote: 20,
  restore_snapshot: 30,
  block_for_review: 90,
};

const getFindingOperationId = (finding: SyncConvergenceFinding): number | undefined => {
  const operationId = Number(finding.evidence.operationId);
  return Number.isFinite(operationId) ? operationId : undefined;
};

const buildRetryOutboxAction = (finding: SyncConvergenceFinding): SyncRecoveryAction => ({
  action: 'retry_outbox',
  safety: 'safe',
  target: finding.path,
  reason: 'Existe trabajo local pendiente recuperable; primero se debe reintentar la cola local.',
  findingType: finding.type,
  operationId: getFindingOperationId(finding),
});

const buildBlockAction = (finding: SyncConvergenceFinding): SyncRecoveryAction => ({
  action: 'block_for_review',
  safety: 'manual_only',
  target: finding.path,
  reason: 'La corrección automática podría elegir una verdad clínica equivocada.',
  findingType: finding.type,
  operationId: getFindingOperationId(finding),
});

const buildRefreshRemoteAction = (finding: SyncConvergenceFinding): SyncRecoveryAction => ({
  action: 'refresh_remote',
  safety: 'safe',
  target: finding.path,
  reason: 'Antes de resolver, refrescar remoto para comprobar si otro cliente ya convergió.',
  findingType: finding.type,
  operationId: getFindingOperationId(finding),
});

const buildRestoreSnapshotAction = (finding: SyncConvergenceFinding): SyncRecoveryAction => ({
  action: 'restore_snapshot',
  safety: 'requires_confirmation',
  target: finding.path,
  reason: 'Hay snapshot disponible, pero restaurarlo requiere confirmación humana.',
  findingType: finding.type,
  operationId: getFindingOperationId(finding),
});

const buildAlreadyAppliedActions = (
  operations: SyncQueueOperationSnapshot[] | undefined
): SyncRecoveryAction[] =>
  (operations || [])
    .filter(operation => operation.syncContract?.resolution === 'already_applied')
    .map(operation => ({
      action: 'mark_already_applied' as const,
      safety: 'safe' as const,
      target: operation.syncContract?.mutationId || operation.key || `syncQueue.${operation.id}`,
      reason: 'La autoridad/remoto ya reconoce esta mutación; corresponde confirmar ack local.',
      operationId: operation.id,
    }));

const hasTrustworthySnapshot = (
  snapshotRecovery: SyncSnapshotRecoveryContext | null | undefined
): boolean => snapshotRecovery?.status === 'available';

const buildFindingActions = (
  finding: SyncConvergenceFinding,
  snapshotRecovery: SyncSnapshotRecoveryContext | null | undefined
): SyncRecoveryAction[] => {
  if (finding.status === 'unsafe' || finding.type === 'duplicate_active_patient') {
    return [buildBlockAction(finding)];
  }

  if (finding.type === 'stale_outbox') {
    return [buildRetryOutboxAction(finding)];
  }

  if (finding.type === 'movement_not_reflected' && Boolean(finding.evidence.pendingOutbox)) {
    return [buildRetryOutboxAction(finding)];
  }

  if (finding.type === 'movement_not_reflected' || finding.type === 'handoff_divergent') {
    return [
      buildRefreshRemoteAction(finding),
      ...(hasTrustworthySnapshot(snapshotRecovery) ? [buildRestoreSnapshotAction(finding)] : []),
      buildBlockAction(finding),
    ];
  }

  if (finding.type === 'snapshot_missing') {
    return [buildBlockAction(finding)];
  }

  if (finding.type === 'repeated_replay') {
    return [buildRetryOutboxAction(finding), buildBlockAction(finding)];
  }

  return [buildBlockAction(finding)];
};

const dedupeActions = (actions: SyncRecoveryAction[]): SyncRecoveryAction[] => {
  const seen = new Set<string>();
  return actions.filter(action => {
    const key = `${action.action}:${action.target}:${action.operationId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const resolvePlanStatus = (
  diagnostic: SyncConvergenceDiagnostic,
  actions: SyncRecoveryAction[]
): SyncRecoveryPlan['status'] => {
  if (diagnostic.status !== 'healthy') return diagnostic.status;
  return actions.length > 0 ? 'recoverable' : 'healthy';
};

export const planSyncRecovery = ({
  diagnostic,
  recentOperations,
  snapshotRecovery,
}: PlanSyncRecoveryInput): SyncRecoveryPlan => {
  const actions = dedupeActions([
    ...buildAlreadyAppliedActions(recentOperations),
    ...diagnostic.findings.flatMap(finding => buildFindingActions(finding, snapshotRecovery)),
  ]).sort((left, right) => ACTION_ORDER[left.action] - ACTION_ORDER[right.action]);
  const status = resolvePlanStatus(diagnostic, actions);

  return {
    status,
    actions,
    summary:
      actions.length === 0
        ? 'No se requieren acciones de recuperación.'
        : `Plan de recuperación ${status}: ${actions.length} acción(es) sugerida(s), ninguna automática agresiva.`,
  };
};
