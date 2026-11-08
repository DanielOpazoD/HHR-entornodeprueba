import type { OperationalTelemetryOperation } from '@/services/observability/operationalTelemetryOperations';
import { createDomainObservability } from '@/services/observability/domainObservability';

const backupObservability = createDomainObservability('backup', 'BackupStorage');

type MetricLevel = 'warn' | 'silent';

interface MeasureStorageOperationOptions {
  warningThresholdMs?: number;
  context?: string;
}

const DEFAULT_WARNING_THRESHOLD_MS = 2000;

const now = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const logMetric = (
  operation: OperationalTelemetryOperation,
  elapsedMs: number,
  level: MetricLevel,
  context?: string
): void => {
  if (level !== 'warn') return;
  backupObservability.recordEvent(operation, 'degraded', {
    issues: [`Operacion lenta de storage: ${Math.round(elapsedMs)}ms`],
    context: {
      elapsedMs: Math.round(elapsedMs),
      storageContext: context,
    },
  });
};

export const measureStorageOperation = async <T>(
  operation: OperationalTelemetryOperation,
  runner: () => Promise<T>,
  options: MeasureStorageOperationOptions = {}
): Promise<T> => {
  const threshold = options.warningThresholdMs ?? DEFAULT_WARNING_THRESHOLD_MS;
  const start = now();

  try {
    return await runner();
  } finally {
    const elapsedMs = now() - start;
    const level: MetricLevel = elapsedMs >= threshold ? 'warn' : 'silent';
    logMetric(operation, elapsedMs, level, options.context);
  }
};
