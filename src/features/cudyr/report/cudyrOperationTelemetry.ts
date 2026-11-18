import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { OperationalTelemetryStatus } from '@/services/observability/operationalTelemetryTypes';

/** Numeric diagnostics only. Instrumentation must never interrupt a clinical operation. */
export const recordCudyrOperation = (
  operation: 'cudyr_report_read' | 'cudyr_report_reuse' | 'cudyr_monthly_recovery',
  startedAt: number,
  status: OperationalTelemetryStatus,
  counts: {
    rowCount?: number;
    recordCount?: number;
    unchangedCount?: number;
    failedCount?: number;
  } = {}
): void => {
  try {
    recordOperationalTelemetry(
      {
        category: 'integration',
        operation,
        status,
        context: { durationMs: Math.max(0, performance.now() - startedAt), ...counts },
      },
      { allowSuccess: true }
    );
  } catch {
    // Diagnostics are expendable; the report and its save result are not.
  }
};
