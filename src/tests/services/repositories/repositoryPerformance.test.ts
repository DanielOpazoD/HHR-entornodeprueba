// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRepositoryPerformanceMetrics,
  getRepositoryPerformanceSummary,
  measureRepositoryOperation,
} from '@/services/repositories/repositoryPerformance';

describe('repositoryPerformance', () => {
  beforeEach(() => {
    clearRepositoryPerformanceMetrics();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records warning operations and exposes recent warning summaries', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await measureRepositoryOperation('fast-op', async () => 'ok', { thresholdMs: 9999 });
    const slowOperation = measureRepositoryOperation(
      'slow-op',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'ok';
      },
      { thresholdMs: 0, consoleWarningThresholdMs: 0, context: 'daily-record' }
    );
    await vi.advanceTimersByTimeAsync(5);
    await slowOperation;

    const summary = getRepositoryPerformanceSummary();
    expect(summary.totalRecorded).toBe(2);
    expect(summary.warningCount).toBe(1);
    expect(summary.slowestOperation).toBe('slow-op');
    expect(summary.latestWarningAt).toBeTruthy();
    expect(summary.recentWarningOperations[0]).toMatchObject({
      operation: 'slow-op',
      context: 'daily-record',
    });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('keeps moderate slow operations in telemetry without warning the console', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const slowOperation = measureRepositoryOperation(
      'moderate-op',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'ok';
      },
      { thresholdMs: 0, consoleWarningThresholdMs: 10, context: 'daily-record' }
    );
    await vi.advanceTimersByTimeAsync(5);
    await slowOperation;

    const summary = getRepositoryPerformanceSummary();
    expect(summary.warningCount).toBe(1);
    expect(summary.recentWarningOperations[0]).toMatchObject({
      operation: 'moderate-op',
      context: 'daily-record',
    });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
