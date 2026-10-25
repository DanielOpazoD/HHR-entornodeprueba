import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRecordOperationalTelemetry = vi.fn();
const mockRecordOperationalErrorTelemetry = vi.fn();

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: (...args: unknown[]) => mockRecordOperationalTelemetry(...args),
}));

vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalErrorTelemetry: (...args: unknown[]) =>
    mockRecordOperationalErrorTelemetry(...args),
}));

import {
  installBootstrapRuntimeErrorListeners,
  recordBootstrapRuntimeError,
  recordBootstrapRuntimeResult,
} from '@/app-shell/bootstrap/bootstrapRuntimeTelemetry';

describe('bootstrapRuntimeTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records recovery reloads as structured recoverable telemetry', () => {
    recordBootstrapRuntimeResult({
      status: 'reload',
      stage: 'client_recovery',
      clientRecovery: {
        status: 'reload',
        reason: 'legacy-sw',
      },
    });

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'auth',
        operation: 'bootstrap_recovery_reload',
        status: 'degraded',
        runtimeState: 'recoverable',
      })
    );
  });

  it('records blocked bootstrap results as failed startup telemetry', () => {
    recordBootstrapRuntimeResult({
      status: 'blocked',
      stage: 'firebase_ready',
      clientRecovery: {
        status: 'continue',
        reason: null,
      },
      error: new Error('runtime boom'),
      message: 'No se pudo iniciar la app',
    });

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'auth',
        operation: 'bootstrap_runtime_failed',
        status: 'failed',
        runtimeState: 'blocked',
        issues: ['No se pudo iniciar la app'],
      })
    );
  });

  it('records chunk-load bootstrap failures with a dedicated operation', () => {
    recordBootstrapRuntimeError(
      new Error('Failed to fetch dynamically imported module: /assets/chunk-123.js')
    );

    expect(mockRecordOperationalErrorTelemetry).toHaveBeenCalledWith(
      'auth',
      'bootstrap_chunk_load_failed',
      expect.any(Error),
      expect.objectContaining({
        code: 'bootstrap_chunk_load_failed',
        runtimeState: 'blocked',
      }),
      expect.objectContaining({
        context: expect.objectContaining({ phase: 'bootstrap' }),
      })
    );
  });

  it('records a plain fetch failure as a runtime failure in both bootstrap paths', () => {
    const error = new TypeError('Failed to fetch');
    recordBootstrapRuntimeResult({
      status: 'blocked',
      stage: 'firebase_ready',
      clientRecovery: { status: 'continue', reason: null },
      error,
      message: 'No se pudo cargar la configuración sintética.',
    });
    expect(mockRecordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'bootstrap_runtime_failed' })
    );
    recordBootstrapRuntimeError(error);
    expect(mockRecordOperationalErrorTelemetry).toHaveBeenCalledWith(
      'auth',
      'bootstrap_runtime_failed',
      error,
      expect.objectContaining({ code: 'bootstrap_runtime_failed' }),
      expect.any(Object)
    );
  });

  it('wires window error and rejection listeners to structured telemetry', () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    };

    const detach = installBootstrapRuntimeErrorListeners(
      target as unknown as Parameters<typeof installBootstrapRuntimeErrorListeners>[0]
    );

    listeners.get('error')?.({
      message: "Cannot access 'n' before initialization",
      filename: '/assets/vendor-firebase-core.js',
    } as unknown as Event);
    listeners.get('unhandledrejection')?.({
      reason: new Error('runtime rejection'),
    } as unknown as Event);

    expect(mockRecordOperationalTelemetry).toHaveBeenCalledTimes(2);
    expect(mockRecordOperationalTelemetry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operation: 'bootstrap_chunk_load_failed',
      })
    );
    expect(mockRecordOperationalTelemetry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: 'bootstrap_unhandled_rejection',
      })
    );

    detach();
    expect(target.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
