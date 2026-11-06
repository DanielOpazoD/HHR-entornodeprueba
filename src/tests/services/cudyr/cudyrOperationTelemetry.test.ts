import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordCudyrOperation } from '@/services/cudyr/cudyrOperationTelemetry';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());

describe('CUDYR numeric operation diagnostics', () => {
  it.each(['cudyr_report_read', 'cudyr_report_reuse', 'cudyr_monthly_recovery'] as const)(
    'preserves bounded timing and counters for %s through the external privacy gate',
    operation => {
      vi.spyOn(performance, 'now').mockReturnValue(1500);
      recordCudyrOperation(operation, 1000, 'success', { rowCount: 8, unchangedCount: 2 });
      const [event, options] = vi.mocked(recordOperationalTelemetry).mock.lastCall!;
      expect(event).toEqual({
        category: 'integration',
        operation,
        status: 'success',
        context: { durationMs: 500, rowCount: 8, unchangedCount: 2 },
      });
      expect(options).toEqual({ allowSuccess: true });
      const safe = sanitizeOperationalTelemetryEvent({
        ...event,
        timestamp: '2026-11-06T12:00:00Z',
      });
      expect(safe.operation).toBe(operation);
      expect(safe.context).toEqual(event.context);
    }
  );
  it('cannot turn a diagnostic storage failure into a failed clinical operation', () => {
    vi.mocked(recordOperationalTelemetry).mockImplementationOnce(() => {
      throw new Error('Quota');
    });
    expect(() =>
      recordCudyrOperation('cudyr_report_read', performance.now(), 'success')
    ).not.toThrow();
  });
});
