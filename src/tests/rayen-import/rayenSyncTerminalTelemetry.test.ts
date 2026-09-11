import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Un run de Eloísa que termina mal debe dejar rastro fuera de la consola: el build de producción
 * elimina `console.*`, así que sin esto nadie veía el fallo salvo abriendo el historial del día.
 */

const mocks = vi.hoisted(() => ({ recordOperationalTelemetry: vi.fn() }));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: mocks.recordOperationalTelemetry,
}));

import { reportRayenSyncTerminal } from '@/features/rayen-import/observability/rayenSyncDiagnostics';
import { buildServiceSummaries } from '@/services/admin/functionsTelemetryService';
import type { FunctionsTelemetryEntry } from '@/types/functionsTelemetry';

const run = { id: 'run-42', startedAt: '2026-09-10T12:33:35.000Z' };

describe('reportRayenSyncTerminal · operational telemetry', () => {
  beforeEach(() => mocks.recordOperationalTelemetry.mockClear());

  it('records a failed run as an integration failure with its bounded reason only', () => {
    reportRayenSyncTerminal(
      run,
      'failed',
      { date: '2026-09-10', failureReason: 'snapshot_error' },
      '2026-09-10T12:33:36.000Z'
    );

    expect(mocks.recordOperationalTelemetry).toHaveBeenCalledWith({
      category: 'integration',
      status: 'failed',
      operation: 'rayen_sync_run',
      date: '2026-09-10',
      issues: ['snapshot_error'],
      context: {
        runId: 'run-42',
        outcome: 'failed',
        durationMs: 1000,
        failureReason: 'snapshot_error',
      },
    });
    // Privacy: no bed, patient, episode or free-text message may leak into the sink.
    const event = mocks.recordOperationalTelemetry.mock.calls[0]![0] as Record<string, unknown>;
    expect(JSON.stringify(event)).not.toMatch(/bedId|patient|rut|episode|message/i);
  });

  it('records a partial run with its issue counts', () => {
    reportRayenSyncTerminal(run, 'partial', {
      date: '2026-09-10',
      issueReason: 'source_timeout',
      issueCount: 3,
      patientCount: 2,
    });

    expect(mocks.recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'partial',
        issues: ['source_timeout'],
        context: expect.objectContaining({ issueCount: 3, patientCount: 2 }),
      })
    );
  });

  it('leaves complete and cancelled runs out of the sink', () => {
    reportRayenSyncTerminal(run, 'complete', { date: '2026-09-10' });
    reportRayenSyncTerminal(run, 'cancelled', { cancellationReason: 'operator' });

    expect(mocks.recordOperationalTelemetry).not.toHaveBeenCalled();
  });
});

describe('buildServiceSummaries · version-guard blocks', () => {
  const entry = (overrides: Partial<FunctionsTelemetryEntry>): FunctionsTelemetryEntry => ({
    id: 'x',
    service: 'rayenClinicalEnrichment',
    operation: 'applyRayenClinicalEnrichmentBatch',
    status: 'success',
    durationMs: 1000,
    attempt: 1,
    totalAttempts: 1,
    timestamp: '2026-09-10T20:13:55.000Z',
    ...overrides,
  });

  it('reports version-guard rejections apart and keeps them out of the error rate', () => {
    // The 10-09 20:13 run: historical batch ok, today's batch blocked by the version guard,
    // retry ok. Before, this read as a 33% error rate for a sync that ended "Todo al día".
    const [summary] = buildServiceSummaries([
      entry({ id: 'a' }),
      entry({
        id: 'b',
        status: 'failure',
        errorCode: 'failed-precondition',
        context: { authorityStatus: 'blocked' },
      }),
      entry({ id: 'c' }),
    ]);

    expect(summary).toMatchObject({
      total: 3,
      successes: 2,
      failures: 0,
      blocked: 1,
      errorRate: 0,
    });
  });

  it('still counts genuine failures and timeouts', () => {
    const [summary] = buildServiceSummaries([
      entry({ id: 'a' }),
      entry({ id: 'b', status: 'failure', errorCode: 'internal' }),
      entry({ id: 'c', status: 'timeout' }),
      entry({ id: 'd', status: 'failure', context: { authorityStatus: 'blocked' } }),
    ]);

    expect(summary).toMatchObject({ failures: 1, timeouts: 1, blocked: 1, errorRate: 0.5 });
  });
});
