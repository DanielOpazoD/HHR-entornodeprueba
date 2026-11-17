import { repositoryPerformanceLogger } from '@/services/repositories/repositoryLoggers';

type RepositoryMetricLevel = 'silent' | 'telemetry' | 'warn';

const MAX_RECORDED_METRICS = 100;
const MAX_REPORTED_WARNINGS = 5;

export interface RepositoryPerformanceMetric {
  operation: string;
  elapsedMs: number;
  level: RepositoryMetricLevel;
  context?: string;
  recordedAt: string;
  thresholdMs: number;
}

export interface RepositoryPerformanceSummary {
  totalRecorded: number;
  warningCount: number;
  slowestOperationMs: number;
  slowestOperation: string | null;
  latestWarningAt: string | null;
  recentWarningOperations: Array<{
    operation: string;
    elapsedMs: number;
    context?: string;
    recordedAt: string;
  }>;
}

const recordedMetrics: RepositoryPerformanceMetric[] = [];

const now = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
};

const logRepositoryMetric = (
  operation: string,
  elapsedMs: number,
  level: RepositoryMetricLevel,
  thresholdMs: number,
  context?: string
): void => {
  recordedMetrics.push({
    operation,
    elapsedMs,
    level,
    context,
    recordedAt: new Date().toISOString(),
    thresholdMs,
  });
  if (recordedMetrics.length > MAX_RECORDED_METRICS) {
    recordedMetrics.shift();
  }

  if (level === 'silent' || level === 'telemetry') {
    return;
  }

  const message = `[RepositoryPerf] ${operation} took ${Math.round(elapsedMs)}ms${
    context ? ` (${context})` : ''
  }`;
  repositoryPerformanceLogger.warn(message);
};

interface MeasureRepositoryOperationOptions {
  thresholdMs?: number;
  consoleWarningThresholdMs?: number;
  context?: string;
}

export const measureRepositoryOperation = async <T>(
  operation: string,
  work: () => Promise<T>,
  options: MeasureRepositoryOperationOptions = {}
): Promise<T> => {
  const start = now();

  try {
    return await work();
  } finally {
    const elapsedMs = now() - start;
    const thresholdMs = options.thresholdMs ?? 1_500;
    const consoleWarningThresholdMs = Math.max(
      options.consoleWarningThresholdMs ?? 3_000,
      thresholdMs
    );
    const level: RepositoryMetricLevel =
      elapsedMs >= consoleWarningThresholdMs
        ? 'warn'
        : elapsedMs >= thresholdMs
          ? 'telemetry'
          : 'silent';
    logRepositoryMetric(operation, elapsedMs, level, thresholdMs, options.context);
  }
};

export const clearRepositoryPerformanceMetrics = (): void => {
  recordedMetrics.length = 0;
};

export const getRepositoryPerformanceSummary = (): RepositoryPerformanceSummary => {
  const warningMetrics = recordedMetrics.filter(metric => metric.level !== 'silent');
  const slowestMetric = recordedMetrics.reduce<RepositoryPerformanceMetric | null>(
    (slowest, metric) => {
      if (!slowest || metric.elapsedMs > slowest.elapsedMs) {
        return metric;
      }
      return slowest;
    },
    null
  );

  return {
    totalRecorded: recordedMetrics.length,
    warningCount: warningMetrics.length,
    slowestOperationMs: slowestMetric ? Math.round(slowestMetric.elapsedMs) : 0,
    slowestOperation: slowestMetric?.operation || null,
    latestWarningAt: warningMetrics.at(-1)?.recordedAt || null,
    recentWarningOperations: warningMetrics
      .slice(-MAX_REPORTED_WARNINGS)
      .reverse()
      .map(metric => ({
        operation: metric.operation,
        elapsedMs: Math.round(metric.elapsedMs),
        context: metric.context,
        recordedAt: metric.recordedAt,
      })),
  };
};
