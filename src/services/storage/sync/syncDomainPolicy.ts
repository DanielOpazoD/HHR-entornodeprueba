import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncDomainContext, SyncTaskOrigin } from '@/shared/contracts/syncDomainContracts';

export interface SyncDomainRetryProfile {
  id:
    | 'clinical_priority'
    | 'mixed_clinical_priority'
    | 'staffing_handoff_priority'
    | 'movements_priority'
    | 'metadata_remote_priority'
    | 'default_domain_retry';
  retryBudget: number;
  delayMultiplier: number;
  conflictAction: string;
}

export interface SyncQueueDomainMetrics {
  byContext: Record<
    SyncDomainContext,
    { pending: number; failed: number; conflict: number; retrying: number }
  >;
  byOrigin: Partial<Record<SyncTaskOrigin, number>>;
  byRecoveryPolicy: Record<string, number>;
}

const EMPTY_CONTEXT_METRIC = () => ({
  pending: 0,
  failed: 0,
  conflict: 0,
  retrying: 0,
});

export const ALL_SYNC_DOMAIN_CONTEXTS: readonly SyncDomainContext[] = [
  'clinical',
  'staffing',
  'movements',
  'handoff',
  'metadata',
  'unknown',
] as const;

export const normalizeSyncTaskContexts = (
  contexts: SyncDomainContext[] | undefined
): SyncDomainContext[] => {
  const normalized = Array.from(
    new Set((contexts || []).filter((context): context is SyncDomainContext => Boolean(context)))
  );
  return normalized.length > 0 ? normalized : ['unknown'];
};

export const resolveSyncDomainRetryProfile = (
  rawContexts: SyncDomainContext[] | undefined
): SyncDomainRetryProfile => {
  const contexts = normalizeSyncTaskContexts(rawContexts);

  if (contexts.length === 1 && contexts[0] === 'metadata') {
    return {
      id: 'metadata_remote_priority',
      retryBudget: 3,
      delayMultiplier: 1.8,
      conflictAction: 'Revisar metadata remota antes de reintentar o reabrir el registro.',
    };
  }

  if (contexts.length === 1 && contexts[0] === 'movements') {
    return {
      id: 'movements_priority',
      retryBudget: 4,
      delayMultiplier: 1.2,
      conflictAction: 'Revisar movimientos y altas/traslados antes de reconciliar el conflicto.',
    };
  }

  if (contexts.every(context => context === 'staffing' || context === 'handoff')) {
    return {
      id: 'staffing_handoff_priority',
      retryBudget: 4,
      delayMultiplier: 1.35,
      conflictAction:
        'Revisar staffing/handoff local antes de confirmar la resolución del conflicto.',
    };
  }

  if (contexts.includes('clinical')) {
    return {
      id: contexts.length === 1 ? 'clinical_priority' : 'mixed_clinical_priority',
      retryBudget: 5,
      delayMultiplier: 1,
      conflictAction: 'Revisar conflicto clínico con prioridad alta antes de continuar.',
    };
  }

  return {
    id: 'default_domain_retry',
    retryBudget: 4,
    delayMultiplier: 1.5,
    conflictAction: 'Revisar contexto del conflicto antes de reintentar manualmente.',
  };
};

export const buildSyncQueueDomainMetrics = (rows: SyncTask[]): SyncQueueDomainMetrics => {
  const byContext = Object.fromEntries(
    ALL_SYNC_DOMAIN_CONTEXTS.map(context => [context, EMPTY_CONTEXT_METRIC()])
  ) as SyncQueueDomainMetrics['byContext'];
  const byOrigin: SyncQueueDomainMetrics['byOrigin'] = {};
  const byRecoveryPolicy: Record<string, number> = {};

  rows.forEach(row => {
    const contexts = normalizeSyncTaskContexts(row.contexts);
    contexts.forEach(context => {
      if (row.status === 'PENDING') {
        byContext[context].pending += 1;
        if (row.retryCount > 0) {
          byContext[context].retrying += 1;
        }
      }
      if (row.status === 'FAILED') {
        byContext[context].failed += 1;
      }
      if (row.status === 'CONFLICT') {
        byContext[context].conflict += 1;
      }
    });

    if (row.origin) {
      byOrigin[row.origin] = (byOrigin[row.origin] || 0) + 1;
    }

    const recoveryPolicy = row.recoveryPolicy || resolveSyncDomainRetryProfile(contexts).id;
    byRecoveryPolicy[recoveryPolicy] = (byRecoveryPolicy[recoveryPolicy] || 0) + 1;
  });

  return {
    byContext,
    byOrigin,
    byRecoveryPolicy,
  };
};
