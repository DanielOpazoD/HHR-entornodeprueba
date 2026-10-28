import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSyncQueueTelemetryFromRows } from '@/services/storage/sync/syncQueueTelemetryController';
import { buildSyncQueueStats } from '@/hooks/controllers/syncQueueMonitorController';
import { hasLocalSyncAttention } from '@/features/rayen-import/components/localSyncPresentation';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

vi.mock('@/services/storage/sync', () => ({
  retryQuarantinedSyncTask: vi.fn(),
  discardQuarantinedSyncTask: vi.fn(),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

const now = 100_000;
const task = (status: SyncTask['status']): SyncTask => ({
  id: 1,
  opId: 'synthetic-visibility',
  type: 'UPDATE_DAILY_RECORD',
  key: 'daily:2026-10-27',
  payload: { date: '2026-10-27' },
  ownerKey: 'user:synthetic-audit',
  timestamp: now - 20_000,
  retryCount: 0,
  status,
  ...(status === 'PROCESSING'
    ? {
        leaseOwner: 'synthetic-worker',
        attemptId: 'synthetic-attempt',
        leaseUntil: now + 30_000,
      }
    : {}),
});
const project = (rows: SyncTask[]) => {
  const stats = buildSyncQueueStats(buildSyncQueueTelemetryFromRows(rows, now, 25));
  const html = renderToStaticMarkup(
    createElement(RayenSyncQueueDetails, {
      stats,
      operations: rows,
      working: false,
      refresh: async () => {},
    })
  );
  return { stats, html, attention: hasLocalSyncAttention(stats) };
};

describe('unconfirmed queue visibility', () => {
  it('keeps an aged waiting task visible', () => {
    const result = project([task('PENDING')]);
    expect(result.attention).toBe(true);
    expect(result.html).toContain('rayen-local-sync-details');
    expect(result.html).toContain('Pendiente de confirmación');
  });
  it('keeps the send detail while a task is in flight', () => {
    const result = project([task('PROCESSING')]);
    expect(result.html).toContain('rayen-local-sync-details');
    expect(result.html).toContain('Enviando');
  });
  it('keeps the pending attention while an aged task is in flight', () => {
    expect(project([task('PROCESSING')]).attention).toBe(true);
  });
  it('allows a fresh first attempt without an alert while retaining its detail', () => {
    const result = project([{ ...task('PROCESSING'), timestamp: now - 9_999 }]);
    expect(result.attention).toBe(false);
    expect(result.html).toContain('Enviando');
    expect(result.html).not.toContain('Reintentar');
    expect(result.html).not.toContain('Descartar envío');
  });
  it('counts each unconfirmed task once and keeps blocked and retired states separate', () => {
    const rows = (['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT', 'RETIRED'] as const).map(
      (status, index) => ({ ...task(status), id: index + 1 })
    );
    const result = project(rows);
    expect(result.stats).toMatchObject({ pending: 2, failed: 1, conflict: 1, retrying: 0 });
    expect(result.html).toContain('Guardado local · 4 por enviar');
  });
  it('preserves retry age and operational budgets during an active send', () => {
    const telemetry = buildSyncQueueTelemetryFromRows(
      [
        {
          ...task('PROCESSING'),
          timestamp: 1,
          leaseUntil: 1_030_001,
          retryCount: 1,
          origin: 'direct_queue',
        },
      ],
      1_000_001,
      25
    );
    expect(telemetry).toMatchObject({
      pending: 1,
      retrying: 1,
      oldestPendingAgeMs: 1_000_000,
      oldestDirectQueueAgeMs: 1_000_000,
      oldestPendingBudgetState: 'critical',
      directQueueBudgetState: 'critical',
      retryingBudgetState: 'warning',
      runtimeState: 'blocked',
    });
  });
  it('no longer needs send detail after confirmation removes the task', () => {
    const result = project([]);
    expect(result.attention).toBe(false);
    expect(result.html).not.toContain('rayen-local-sync-details');
  });
});
