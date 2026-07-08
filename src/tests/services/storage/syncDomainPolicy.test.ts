import { describe, expect, it } from 'vitest';
import {
  buildSyncQueueDomainMetrics,
  resolveSyncDomainRetryProfile,
} from '@/services/storage/sync/syncDomainPolicy';

describe('syncDomainPolicy', () => {
  it('assigns stricter retry budget to metadata-only tasks', () => {
    const metadataProfile = resolveSyncDomainRetryProfile(['metadata']);
    const clinicalProfile = resolveSyncDomainRetryProfile(['clinical']);

    expect(metadataProfile.id).toBe('metadata_remote_priority');
    expect(metadataProfile.retryBudget).toBeLessThan(clinicalProfile.retryBudget);
    expect(metadataProfile.delayMultiplier).toBeGreaterThan(clinicalProfile.delayMultiplier);
  });

  it('assigns movement and handoff retry profiles by clinical intent', () => {
    expect(resolveSyncDomainRetryProfile(['movements'])).toMatchObject({
      id: 'movements_priority',
      retryBudget: 4,
      delayMultiplier: 1.2,
    });
    expect(resolveSyncDomainRetryProfile(['staffing', 'handoff'])).toMatchObject({
      id: 'staffing_handoff_priority',
      retryBudget: 4,
      delayMultiplier: 1.35,
    });
    expect(resolveSyncDomainRetryProfile(undefined)).toMatchObject({
      id: 'default_domain_retry',
    });
  });

  it('builds per-context metrics from queued tasks', () => {
    const metrics = buildSyncQueueDomainMetrics([
      {
        opId: 'one',
        type: 'UPDATE_DAILY_RECORD',
        payload: {},
        timestamp: 1,
        retryCount: 0,
        status: 'PENDING',
        contexts: ['clinical'],
        origin: 'full_save_retry',
        recoveryPolicy: 'clinical_priority',
      },
      {
        opId: 'two',
        type: 'UPDATE_DAILY_RECORD',
        payload: {},
        timestamp: 2,
        retryCount: 1,
        status: 'CONFLICT',
        contexts: ['handoff'],
        origin: 'conflict_auto_merge',
        recoveryPolicy: 'staffing_handoff_priority',
      },
      {
        opId: 'three',
        type: 'UPDATE_DAILY_RECORD',
        payload: {},
        timestamp: 3,
        retryCount: 2,
        status: 'PENDING',
        contexts: ['movements'],
      },
      {
        opId: 'four',
        type: 'UPDATE_DAILY_RECORD',
        payload: {},
        timestamp: 4,
        retryCount: 0,
        status: 'FAILED',
        contexts: ['metadata'],
      },
    ]);

    expect(metrics.byContext.clinical.pending).toBe(1);
    expect(metrics.byContext.handoff.conflict).toBe(1);
    expect(metrics.byContext.movements.retrying).toBe(1);
    expect(metrics.byContext.metadata.failed).toBe(1);
    expect(metrics.byOrigin.full_save_retry).toBe(1);
    expect(metrics.byOrigin.conflict_auto_merge).toBe(1);
    expect(metrics.byRecoveryPolicy.clinical_priority).toBe(1);
    expect(metrics.byRecoveryPolicy.movements_priority).toBe(1);
    expect(metrics.byRecoveryPolicy.metadata_remote_priority).toBe(1);
  });
});
