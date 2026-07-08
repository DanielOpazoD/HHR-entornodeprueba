import { describe, expect, it } from 'vitest';
import { planSyncRecovery } from '@/services/observability/syncRecoveryPlanner';
import type { SyncConvergenceDiagnostic } from '@/services/observability/syncConvergenceDiagnostics';
import type { SyncQueueOperationSnapshot } from '@/services/storage/sync';

const makeDiagnostic = (
  overrides: Partial<SyncConvergenceDiagnostic> = {}
): SyncConvergenceDiagnostic => ({
  status: 'recoverable',
  summary: 'sync recoverable',
  checkedAt: '2026-07-02T10:00:00.000Z',
  findings: [],
  ...overrides,
});

const makeOperation = (
  overrides: Partial<SyncQueueOperationSnapshot> = {}
): SyncQueueOperationSnapshot => ({
  id: 1,
  type: 'UPDATE_DAILY_RECORD',
  status: 'PENDING',
  retryCount: 0,
  timestamp: Date.parse('2026-07-02T09:45:00.000Z'),
  key: 'daily:2026-07-02',
  ...overrides,
});

describe('syncRecoveryPlanner', () => {
  it('suggests retrying stale or pending recoverable outbox work first', () => {
    const plan = planSyncRecovery({
      diagnostic: makeDiagnostic({
        findings: [
          {
            type: 'stale_outbox',
            status: 'recoverable',
            severity: 'warning',
            path: 'daily:2026-07-02',
            module: 'sync',
            message: 'Outbox viejo',
            evidence: { operationId: 7 },
          },
        ],
      }),
      recentOperations: [makeOperation({ id: 7 })],
    });

    expect(plan.status).toBe('recoverable');
    expect(plan.summary).toContain('recuperación');
    expect(plan.actions[0]).toMatchObject({
      action: 'retry_outbox',
      safety: 'safe',
      target: 'daily:2026-07-02',
    });
  });

  it('blocks automatic repair for unsafe duplicate patients', () => {
    const plan = planSyncRecovery({
      diagnostic: makeDiagnostic({
        status: 'unsafe',
        findings: [
          {
            type: 'duplicate_active_patient',
            status: 'unsafe',
            severity: 'critical',
            path: 'beds.R2',
            module: 'censo',
            affectedPatient: 'Ana Perez',
            message: 'Paciente duplicado',
            evidence: { firstBedId: 'R1', duplicateBedId: 'R2' },
          },
        ],
      }),
    });

    expect(plan.status).toBe('unsafe');
    expect(plan.actions[0]).toMatchObject({
      action: 'block_for_review',
      safety: 'manual_only',
      target: 'beds.R2',
      reason: expect.stringContaining('corrección automática'),
    });
  });

  it('suggests restore from snapshot only when a trustworthy snapshot exists', () => {
    const plan = planSyncRecovery({
      diagnostic: makeDiagnostic({
        status: 'needs_review',
        findings: [
          {
            type: 'movement_not_reflected',
            status: 'needs_review',
            severity: 'critical',
            path: 'discharges.D1',
            module: 'censo',
            affectedPatient: 'Bernardo Orrego',
            message: 'Alta no reflejada',
            evidence: { pendingOutbox: false },
          },
        ],
      }),
      snapshotRecovery: { status: 'available' },
    });

    expect(plan.status).toBe('needs_review');
    expect(plan.actions.map(action => action.action)).toEqual([
      'refresh_remote',
      'restore_snapshot',
      'block_for_review',
    ]);
    expect(plan.actions.find(action => action.action === 'restore_snapshot')).toMatchObject({
      safety: 'requires_confirmation',
      target: 'discharges.D1',
      reason: expect.stringContaining('confirmación humana'),
    });
  });

  it('marks already-applied mutations as ack candidates instead of replaying them', () => {
    const plan = planSyncRecovery({
      diagnostic: makeDiagnostic({ status: 'healthy' }),
      recentOperations: [
        makeOperation({
          id: 12,
          syncContract: {
            mutationId: 'mutation-already-applied',
            resolution: 'already_applied',
            acceptedVersion: '2026-07-02T10:00:00.000Z',
          },
        }),
      ],
    });

    expect(plan.status).toBe('recoverable');
    expect(plan.actions[0]).toMatchObject({
      action: 'mark_already_applied',
      safety: 'safe',
      target: 'mutation-already-applied',
    });
  });
});
