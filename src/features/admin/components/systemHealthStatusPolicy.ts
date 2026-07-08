import type { UserHealthStatus } from '@/services/admin/healthService';
import {
  DEFAULT_SYSTEM_HEALTH_THRESHOLDS,
  type SystemHealthThresholds,
} from '@/services/admin/systemHealthOperationalBudgets';

export interface SystemHealthState {
  level: 'healthy' | 'warning' | 'critical';
  badgeLabel: 'SALUDABLE' | 'ADVERTENCIA' | 'CRITICO';
  badgeClassName: string;
  cardClassName: string;
  actionHint: string;
  reasons: string[];
  recommendedActions: string[];
}

export const evaluateSystemHealthState = (
  status: UserHealthStatus,
  thresholds: SystemHealthThresholds = DEFAULT_SYSTEM_HEALTH_THRESHOLDS
): SystemHealthState => {
  const conflictSyncTasks = status.conflictSyncTasks || 0;
  const retryingSyncTasks = status.retryingSyncTasks || 0;
  const oldestPendingAgeMs = status.oldestPendingAgeMs || 0;
  const oldestDirectQueueAgeMs = status.oldestDirectQueueAgeMs || 0;
  const reasons: string[] = [];

  if (!status.isOnline) reasons.push('usuario sin conectividad');
  if (status.failedSyncTasks > 0) reasons.push('hay sincronizaciones fallidas');
  if (conflictSyncTasks > 0) reasons.push('hay conflictos pendientes');
  if ((status.syncOrphanedTasks || 0) > 0) reasons.push('ownership local del outbox contaminado');
  if (retryingSyncTasks >= thresholds.warningRetryingSyncTasks)
    reasons.push('cola en modo reintento');
  if (oldestPendingAgeMs >= thresholds.warningOldestPendingAgeMs)
    reasons.push('cola con antiguedad elevada');
  if (oldestDirectQueueAgeMs >= thresholds.warningOldestPendingAgeMs)
    reasons.push(
      oldestDirectQueueAgeMs >= thresholds.criticalOldestPendingAgeMs
        ? 'pre-outbox directo pendiente con antiguedad critica'
        : 'pre-outbox directo pendiente con antiguedad elevada'
    );
  if (status.pendingMutations >= thresholds.warningPendingMutations)
    reasons.push('mutaciones pendientes acumuladas');
  if (status.localErrorCount >= thresholds.warningLocalErrorCount)
    reasons.push('errores locales acumulados');
  if (status.degradedLocalPersistence) reasons.push('persistencia local degradada');
  if (status.isOutdated) reasons.push('cliente desactualizado o incompatible');
  if (status.repositoryWarningCount > 0) reasons.push('operaciones lentas del repositorio');
  if (status.slowestRepositoryOperationMs >= thresholds.warningSlowRepositoryOperationMs)
    reasons.push('operaciones criticas con latencia elevada');

  const hasCriticalSync =
    status.failedSyncTasks > 0 ||
    conflictSyncTasks > 0 ||
    retryingSyncTasks >= thresholds.criticalRetryingSyncTasks ||
    oldestPendingAgeMs >= thresholds.criticalOldestPendingAgeMs ||
    oldestDirectQueueAgeMs >= thresholds.criticalOldestPendingAgeMs;
  const hasCriticalVolume =
    status.pendingMutations >= thresholds.criticalPendingMutations ||
    status.localErrorCount >= thresholds.criticalLocalErrorCount ||
    status.degradedLocalPersistence ||
    status.isOutdated ||
    (status.syncOrphanedTasks || 0) > 0 ||
    status.repositoryWarningCount >= thresholds.criticalRepositoryWarningCount ||
    status.slowestRepositoryOperationMs >= thresholds.criticalSlowRepositoryOperationMs;

  if (hasCriticalSync || hasCriticalVolume) {
    return {
      level: 'critical',
      badgeLabel: 'CRITICO',
      badgeClassName: 'bg-red-500 text-white',
      cardClassName: 'from-red-50 to-red-100 border-red-200',
      actionHint:
        'Accion: revisar permisos/reglas y ejecutar limpieza dura si la cola no baja en 15 min.',
      reasons,
      recommendedActions: [
        'Verificar permisos Firestore/Storage y rol del usuario.',
        'Ejecutar Reintentar y observar si pending baja en 5 minutos.',
        'Si persiste, ejecutar Limpieza Dura y escalar con evidencia.',
      ],
    };
  }

  const hasWarning =
    !status.isOnline ||
    status.pendingMutations >= thresholds.warningPendingMutations ||
    status.pendingSyncTasks > 0 ||
    retryingSyncTasks >= thresholds.warningRetryingSyncTasks ||
    oldestPendingAgeMs >= thresholds.warningOldestPendingAgeMs ||
    oldestDirectQueueAgeMs >= thresholds.warningOldestPendingAgeMs ||
    status.localErrorCount >= thresholds.warningLocalErrorCount ||
    status.repositoryWarningCount >= thresholds.warningRepositoryWarningCount ||
    status.slowestRepositoryOperationMs >= thresholds.warningSlowRepositoryOperationMs;

  if (hasWarning) {
    return {
      level: 'warning',
      badgeLabel: 'ADVERTENCIA',
      badgeClassName: 'bg-amber-500 text-white',
      cardClassName: 'from-amber-50 to-amber-100 border-amber-200',
      actionHint:
        'Accion: monitorear cola y reintentos. Si crece, validar conectividad del usuario.',
      reasons,
      recommendedActions: [
        'Monitorear que pending/retrying no crezcan por 10 minutos.',
        'Confirmar conectividad estable del usuario.',
        'Reintentar sincronizacion si hay tareas pendientes.',
      ],
    };
  }

  return {
    level: 'healthy',
    badgeLabel: 'SALUDABLE',
    badgeClassName: 'bg-emerald-500 text-white',
    cardClassName: 'from-emerald-50 to-white border-emerald-100',
    actionHint: 'Accion: sin intervencion. Estado operativo estable.',
    reasons: ['estado operativo estable'],
    recommendedActions: ['Sin accion correctiva requerida.'],
  };
};

export { DEFAULT_SYSTEM_HEALTH_THRESHOLDS };
export type { SystemHealthThresholds };
