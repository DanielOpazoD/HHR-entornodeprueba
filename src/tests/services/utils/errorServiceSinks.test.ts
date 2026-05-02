import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ErrorLog } from '@/services/logging/errorLogTypes';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';
import {
  auditErrorSink,
  buildDefaultErrorServiceSinks,
  createSafeErrorServiceSink,
  externalTelemetryErrorSink,
  runErrorServiceSinks,
} from '@/services/utils/errorServiceSinks';

vi.mock('@/services/admin/auditService', () => ({
  logSystemError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/storage/indexeddb/indexedDbErrorLogService', () => ({
  saveErrorLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: vi.fn().mockResolvedValue(true),
}));

import { logSystemError } from '@/services/admin/auditService';
import { saveErrorLog } from '@/services/storage/indexeddb/indexedDbErrorLogService';
import { dispatchOperationalTelemetryExternally } from '@/services/observability/operationalTelemetryExternalAdapter';

const buildErrorLog = (severity: ErrorLog['severity'] = 'high'): ErrorLog => ({
  id: 'err-1',
  timestamp: '2026-03-08T12:00:00.000Z',
  message: 'Fallo de prueba',
  severity,
  context: { module: 'test' },
  url: 'http://localhost:3000',
  userAgent: 'vitest',
});

describe('errorServiceSinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists high severity errors to audit and external telemetry', async () => {
    const errorLog = buildErrorLog('high');

    await auditErrorSink(errorLog);
    await externalTelemetryErrorSink(errorLog);

    expect(logSystemError).toHaveBeenCalledWith(
      'Fallo de prueba',
      'high',
      expect.objectContaining({
        originalErrorId: 'err-1',
      })
    );
    expect(dispatchOperationalTelemetryExternally).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        status: 'failed',
        operation: 'error_service_log',
      })
    );
  });

  it('fans out through default sinks without duplicating IndexedDB persistence', async () => {
    const sinks = buildDefaultErrorServiceSinks({ allowDevConsole: false });
    const errorLog = buildErrorLog('medium');

    await runErrorServiceSinks(errorLog, sinks);

    expect(saveErrorLog).toHaveBeenCalledTimes(1);
    expect(logSystemError).not.toHaveBeenCalled();
    expect(dispatchOperationalTelemetryExternally).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'degraded',
      })
    );
  });

  it('wraps sink errors without aborting the pipeline', async () => {
    const consoleSpies = suppressConsole(['error']);
    const sink = createSafeErrorServiceSink(
      'broken-sink',
      vi.fn().mockRejectedValue(new Error('broken'))
    );

    try {
      await expect(sink(buildErrorLog('low'))).resolves.toBeUndefined();
    } finally {
      restoreConsole(consoleSpies);
    }
  });
});
