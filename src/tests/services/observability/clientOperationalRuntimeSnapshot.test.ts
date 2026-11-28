// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildClientOperationalRuntimeSnapshot } from '@/services/observability/clientOperationalRuntimeSnapshot';

describe('clientOperationalRuntimeSnapshot', () => {
  it('escalates to blocked when sync telemetry cannot be read', () => {
    const snapshot = buildClientOperationalRuntimeSnapshot({
      auth: {
        sessionStatus: 'authorized',
        authLoading: false,
        isFirebaseConnected: true,
        isOnline: true,
        bootstrapPending: false,
        pendingAgeMs: 0,
        budgetProfile: 'default',
        timeoutMs: 15000,
        runtimeState: 'ok',
        issues: [],
      },
      localPersistence: {
        indexedDbAvailable: true,
        fallbackMode: false,
        runtimeState: 'ok',
      },
      sync: {
        pending: 0,
        failed: 0,
        conflict: 0,
        retrying: 0,
        oldestPendingAgeMs: 0,
        batchSize: 25,
        oldestPendingBudgetState: 'ok',
        retryingBudgetState: 'ok',
        runtimeState: 'blocked',
        readState: 'unavailable',
        issues: ['IndexedDB unavailable'],
      },
    });

    expect(snapshot.runtimeState).toBe('blocked');
    expect(snapshot.degradedLocalPersistence).toBe(true);
    expect(snapshot.syncReadUnavailable).toBe(true);
    expect(snapshot.issues).toContain('IndexedDB unavailable');
  });

  it('preserves unauthorized auth as the highest-priority runtime state', () => {
    const snapshot = buildClientOperationalRuntimeSnapshot({
      auth: {
        sessionStatus: 'unauthorized',
        authLoading: false,
        isFirebaseConnected: false,
        isOnline: true,
        bootstrapPending: false,
        pendingAgeMs: 0,
        budgetProfile: 'default',
        timeoutMs: 15000,
        runtimeState: 'unauthorized',
        issues: ['Rol no autorizado'],
      },
      localPersistence: {
        indexedDbAvailable: true,
        fallbackMode: true,
        runtimeState: 'recoverable',
      },
      sync: {
        pending: 1,
        failed: 0,
        conflict: 0,
        retrying: 1,
        oldestPendingAgeMs: 30,
        batchSize: 25,
        oldestPendingBudgetState: 'ok',
        retryingBudgetState: 'warning',
        runtimeState: 'degraded',
        readState: 'ok',
      },
    });

    expect(snapshot.runtimeState).toBe('unauthorized');
    expect(snapshot.issues).toContain('Rol no autorizado');
  });
});
