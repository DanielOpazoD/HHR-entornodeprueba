import { describe, expect, it } from 'vitest';
import {
  evaluateSystemHealthState,
  DEFAULT_SYSTEM_HEALTH_THRESHOLDS,
} from '@/features/admin/components/systemHealthStatusPolicy';
import { UserHealthStatus } from '@/services/admin/healthService';

const baseStatus = (): UserHealthStatus => ({
  uid: 'u1',
  email: 'user@example.com',
  displayName: 'User',
  lastSeen: '2026-02-20T00:00:00.000Z',
  isOnline: true,
  isOutdated: false,
  pendingMutations: 0,
  pendingSyncTasks: 0,
  failedSyncTasks: 0,
  conflictSyncTasks: 0,
  retryingSyncTasks: 0,
  syncOrphanedTasks: 0,
  oldestPendingAgeMs: 0,
  oldestDirectQueueAgeMs: 0,
  remoteSyncReason: 'ready',
  versionUpdateReason: 'current',
  localErrorCount: 0,
  degradedLocalPersistence: false,
  repositoryWarningCount: 0,
  slowestRepositoryOperationMs: 0,
  operationalObservedCount: 0,
  operationalFailureCount: 0,
  operationalRetryableCount: 0,
  operationalRecoverableCount: 0,
  operationalDegradedCount: 0,
  operationalBlockedCount: 0,
  operationalUnauthorizedCount: 0,
  operationalLastHourObservedCount: 0,
  operationalSyncObservedCount: 0,
  operationalIndexedDbObservedCount: 0,
  operationalClinicalDocumentObservedCount: 0,
  operationalCreateDayObservedCount: 0,
  operationalHandoffObservedCount: 0,
  operationalExportBackupObservedCount: 0,
  operationalTopObservedCategory: undefined,
  operationalTopObservedOperation: undefined,
  latestOperationalOperation: undefined,
  latestOperationalRuntimeState: undefined,
  appVersion: 'v1',
  platform: 'MacIntel',
  userAgent: 'Vitest',
});

describe('systemHealthStatusPolicy', () => {
  it('returns healthy when all indicators are normal', () => {
    const result = evaluateSystemHealthState(baseStatus());
    expect(result.level).toBe('healthy');
    expect(result.badgeLabel).toBe('SALUDABLE');
    expect(result.recommendedActions[0]).toContain('Sin accion');
  });

  it('returns warning for pending queue growth', () => {
    const status = baseStatus();
    status.pendingMutations = DEFAULT_SYSTEM_HEALTH_THRESHOLDS.warningPendingMutations;

    const result = evaluateSystemHealthState(status);
    expect(result.level).toBe('warning');
    expect(result.badgeLabel).toBe('ADVERTENCIA');
  });

  it('returns critical for failed sync tasks', () => {
    const status = baseStatus();
    status.failedSyncTasks = 1;

    const result = evaluateSystemHealthState(status);
    expect(result.level).toBe('critical');
    expect(result.badgeLabel).toBe('CRITICO');
    expect(result.reasons).toContain('hay sincronizaciones fallidas');
    expect(result.recommendedActions.length).toBeGreaterThan(1);
  });

  it('returns critical when oldest pending age breaches threshold', () => {
    const status = baseStatus();
    status.oldestPendingAgeMs = DEFAULT_SYSTEM_HEALTH_THRESHOLDS.criticalOldestPendingAgeMs;

    const result = evaluateSystemHealthState(status);
    expect(result.level).toBe('critical');
  });

  it('returns critical when direct_queue pre-outbox work stays old', () => {
    const status = baseStatus();
    status.oldestDirectQueueAgeMs = DEFAULT_SYSTEM_HEALTH_THRESHOLDS.criticalOldestPendingAgeMs;

    const result = evaluateSystemHealthState(status);
    expect(result.level).toBe('critical');
    expect(result.reasons).toContain('pre-outbox directo pendiente con antiguedad critica');
  });

  it('returns critical when local persistence is degraded', () => {
    const status = baseStatus();
    status.degradedLocalPersistence = true;

    const result = evaluateSystemHealthState(status);
    expect(result.level).toBe('critical');
    expect(result.reasons).toContain('persistencia local degradada');
  });

  it('returns critical when the client is outdated or the outbox owner drifts', () => {
    const status = baseStatus();
    status.isOutdated = true;
    status.syncOrphanedTasks = 1;

    const result = evaluateSystemHealthState(status);
    expect(result.level).toBe('critical');
    expect(result.reasons).toContain('cliente desactualizado o incompatible');
    expect(result.reasons).toContain('ownership local del outbox contaminado');
  });

  it('returns warning when repository operations get slow', () => {
    const status = baseStatus();
    status.repositoryWarningCount = 1;
    status.slowestRepositoryOperationMs =
      DEFAULT_SYSTEM_HEALTH_THRESHOLDS.warningSlowRepositoryOperationMs;

    const result = evaluateSystemHealthState(status);
    expect(result.level).toBe('warning');
    expect(result.reasons).toContain('operaciones lentas del repositorio');
  });
});
