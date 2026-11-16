import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

export const publishAdmissionEffects = (occurrences: number): void => {
  // One event per admission with the number of days: a range of hundreds must not flood the
  // receiver, whose rate limit would drop most of them and undercount.
  if (occurrences > 0)
    recordOperationalTelemetry({
      category: 'indexeddb',
      operation: 'indexeddb_save_records',
      status: 'degraded',
      context: {
        reason: 'unheld_newer_local_replaced',
        count: occurrences,
      },
    });
};
