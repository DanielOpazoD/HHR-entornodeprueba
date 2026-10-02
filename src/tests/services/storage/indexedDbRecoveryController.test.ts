// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  recordIndexedDbFallbackMode,
  recordIndexedDbRecoveryFailure,
  recordIndexedDbRecoveryNotice,
} from '@/services/storage/indexeddb/indexedDbRecoveryController';

const mockRecordOperationalTelemetry = vi.fn();

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: (...args: unknown[]) => mockRecordOperationalTelemetry(...args),
}));

describe('indexedDbRecoveryController', () => {
  it('records blocked recovery failures by default', () => {
    recordIndexedDbRecoveryFailure(new Error('boom'));

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'indexeddb',
        operation: 'indexeddb_recovery',
        status: 'failed',
        runtimeState: 'blocked',
      })
    );
  });

  it('records fallback mode as recoverable with merged context', () => {
    recordIndexedDbFallbackMode('VersionError', 'fallback active', { maxAttempts: 3 });

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'indexeddb_fallback_mode',
        status: 'degraded',
        runtimeState: 'recoverable',
        context: expect.objectContaining({
          errorName: 'VersionError',
          maxAttempts: 3,
        }),
      })
    );
  });

  it('records notices with explicit runtime state', () => {
    recordIndexedDbRecoveryNotice(
      'indexeddb_recovery_disabled',
      'stopped',
      { attempts: 3 },
      'blocked'
    );

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'indexeddb_recovery_disabled',
        status: 'failed',
        runtimeState: 'blocked',
      })
    );
  });
});
