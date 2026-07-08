import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSyncQueueTelemetryFromRows,
  recordSyncQueueBudgetTelemetry,
  recordSyncQueueTruthSelectionTelemetry,
} from '@/services/storage/sync/syncQueueTelemetryController';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { sanitizeSyncContractForOperationalSnapshot } from '@/services/storage/sync/syncQueueTaskFactory';

const mockRecordOperationalTelemetry = vi.fn();

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: (...args: unknown[]) => mockRecordOperationalTelemetry(...args),
}));

const baseTask = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'task-1',
  type: 'UPDATE_DAILY_RECORD',
  payload: { date: '2026-03-22' },
  timestamp: Date.parse('2026-03-22T10:00:00.000Z'),
  retryCount: 0,
  status: 'PENDING',
  ...overrides,
});

describe('syncQueueTelemetryController', () => {
  beforeEach(() => {
    mockRecordOperationalTelemetry.mockClear();
  });

  it('builds degraded telemetry when retrying reaches warning threshold', () => {
    const telemetry = buildSyncQueueTelemetryFromRows(
      [baseTask({ retryCount: 1 })],
      Date.parse('2026-03-22T10:01:00.000Z'),
      25
    );

    expect(telemetry.retryingBudgetState).toBe('warning');
    expect(telemetry.oldestPendingBudgetState).toBe('ok');
    expect(telemetry.runtimeState).toBe('degraded');
  });

  it('builds blocked telemetry when pending tasks exceed the critical queue threshold', () => {
    const telemetry = buildSyncQueueTelemetryFromRows(
      Array.from({ length: 192 }, (_, index) =>
        baseTask({
          opId: `task-${index + 1}`,
          timestamp: Date.parse('2026-03-22T10:00:00.000Z') + index,
        })
      ),
      Date.parse('2026-03-22T10:01:00.000Z'),
      25
    );

    expect(telemetry.pending).toBe(192);
    expect(telemetry.pendingBudgetState).toBe('critical');
    expect(telemetry.runtimeState).toBe('blocked');
  });

  it('builds blocked telemetry when oldest pending age exceeds critical threshold', () => {
    const telemetry = buildSyncQueueTelemetryFromRows(
      [baseTask({ timestamp: Date.parse('2026-03-22T09:40:00.000Z') })],
      Date.parse('2026-03-22T10:00:00.000Z'),
      25
    );

    expect(telemetry.oldestPendingBudgetState).toBe('critical');
    expect(telemetry.runtimeState).toBe('blocked');
  });

  it('tracks direct_queue age separately for stale pre-outbox support alerts', () => {
    const telemetry = buildSyncQueueTelemetryFromRows(
      [
        baseTask({
          origin: 'direct_queue',
          timestamp: Date.parse('2026-03-22T09:40:00.000Z'),
        }),
        baseTask({
          opId: 'task-2',
          origin: 'partial_update_retry',
          timestamp: Date.parse('2026-03-22T09:59:00.000Z'),
        }),
      ],
      Date.parse('2026-03-22T10:00:00.000Z'),
      25
    );

    expect(telemetry.oldestDirectQueueAgeMs).toBe(1_200_000);
    expect(telemetry.directQueueBudgetState).toBe('critical');
    expect(telemetry.runtimeState).toBe('blocked');
  });

  it('records budget telemetry only when queue exceeds operational thresholds', () => {
    recordSyncQueueBudgetTelemetry({
      pending: 1,
      failed: 0,
      conflict: 0,
      retrying: 1,
      oldestPendingAgeMs: 1000,
      batchSize: 25,
      pendingBudgetState: 'ok',
      oldestPendingBudgetState: 'ok',
      retryingBudgetState: 'warning',
      runtimeState: 'degraded',
    });

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        operation: 'sync_queue_budget_threshold',
        status: 'degraded',
        runtimeState: 'degraded',
      })
    );
  });

  it('sanitizes client and tab identifiers in operational sync snapshots', () => {
    const snapshot = sanitizeSyncContractForOperationalSnapshot({
      expectedVersion: '2026-03-22T09:00:00.000Z',
      acceptedVersion: '2026-03-22T10:00:00.000Z',
      resolution: 'merged',
      changedPaths: ['beds.R1.pathology'],
      mutationId: 'mutation-visible',
      clientId: 'raw-client-id',
      tabId: 'raw-tab-id',
    });

    expect(snapshot).toMatchObject({
      expectedVersion: '2026-03-22T09:00:00.000Z',
      acceptedVersion: '2026-03-22T10:00:00.000Z',
      resolution: 'merged',
      changedPaths: ['beds.R1.pathology'],
      mutationId: 'mutation-visible',
    });
    expect(snapshot?.clientId).toMatch(/^anon_/);
    expect(snapshot?.tabId).toMatch(/^anon_/);
    expect(snapshot?.clientId).not.toBe('raw-client-id');
    expect(snapshot?.tabId).not.toBe('raw-tab-id');
  });

  it('records semantic truth selection telemetry for sync mutations', () => {
    recordSyncQueueTruthSelectionTelemetry(
      baseTask({
        key: 'daily:2026-03-22',
        contexts: ['clinical', 'handoff'],
        origin: 'partial_update_retry',
        syncContract: {
          expectedVersion: '2026-03-22T09:00:00.000Z',
          acceptedVersion: '2026-03-22T10:00:00.000Z',
          resolution: 'merged',
          mutationId: 'mutation-trace',
          clientId: 'raw-client-id',
          tabId: 'raw-tab-id',
          changedPaths: ['beds.R1.handoffNoteDayShift'],
        },
      }),
      {
        resolution: 'merged',
        acceptedVersion: '2026-03-22T10:00:00.000Z',
        acceptedRevision: 12,
        selectedTruth: 'authority_intent_invariants',
      }
    );

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        operation: 'sync_queue_truth_selected',
        status: 'success',
        runtimeState: 'recoverable',
        context: expect.objectContaining({
          key: 'daily:2026-03-22',
          resolution: 'merged',
          selectedTruth: 'authority_intent_invariants',
          expectedVersion: '2026-03-22T09:00:00.000Z',
          acceptedVersion: '2026-03-22T10:00:00.000Z',
          acceptedRevision: 12,
          mutationId: 'mutation-trace',
          changedPaths: ['beds.R1.handoffNoteDayShift'],
          contexts: ['clinical', 'handoff'],
          origin: 'partial_update_retry',
        }),
      }),
      { allowSuccess: true }
    );
    const eventContext = mockRecordOperationalTelemetry.mock.calls[0]?.[0]?.context as Record<
      string,
      unknown
    >;
    expect(eventContext.clientId).toMatch(/^anon_/);
    expect(eventContext.tabId).toMatch(/^anon_/);
    expect(JSON.stringify(eventContext)).not.toContain('raw-client-id');
    expect(JSON.stringify(eventContext)).not.toContain('raw-tab-id');
  });

  it('records stale truth selection as retryable degraded telemetry', () => {
    recordSyncQueueTruthSelectionTelemetry(
      baseTask({
        key: 'daily:2026-03-22',
        contexts: ['clinical'],
        syncContract: {
          expectedVersion: '2026-03-22T09:00:00.000Z',
          mutationId: 'mutation-stale',
          changedPaths: ['beds.R1.pathology'],
        },
      }),
      {
        resolution: 'stale',
        selectedTruth: 'authority_intent_invariants',
      }
    );

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'sync_queue_truth_selected',
        status: 'degraded',
        runtimeState: 'retryable',
        context: expect.objectContaining({
          resolution: 'stale',
          expectedVersion: '2026-03-22T09:00:00.000Z',
          acceptedVersion: undefined,
        }),
      }),
      { allowSuccess: true }
    );
  });

  it('records blocked truth selection with a clinical authority issue', () => {
    recordSyncQueueTruthSelectionTelemetry(
      baseTask({
        key: 'daily:2026-03-22',
        contexts: ['clinical'],
        syncContract: {
          expectedVersion: '2026-03-22T09:00:00.000Z',
          mutationId: 'mutation-blocked',
          changedPaths: ['beds.R1.pathology'],
        },
      }),
      {
        resolution: 'blocked',
        acceptedVersion: '2026-03-22T09:05:00.000Z',
        selectedTruth: 'blocked_before_publish',
      }
    );

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'sync_queue_truth_selected',
        status: 'failed',
        runtimeState: 'blocked',
        issues: ['La autoridad clinica bloqueo la mutacion antes de publicar.'],
        context: expect.objectContaining({
          resolution: 'blocked',
          selectedTruth: 'blocked_before_publish',
          acceptedVersion: '2026-03-22T09:05:00.000Z',
        }),
      }),
      { allowSuccess: true }
    );
  });
});
