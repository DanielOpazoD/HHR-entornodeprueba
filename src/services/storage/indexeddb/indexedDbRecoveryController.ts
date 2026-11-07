import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { OperationalRuntimeState } from '@/services/observability/operationalRuntimeState';

export const recordIndexedDbRecoveryFailure = (
  error: unknown,
  options: {
    runtimeState?: OperationalRuntimeState;
    context?: Record<string, unknown>;
  } = {}
): void => {
  recordOperationalTelemetry({
    category: 'indexeddb',
    status: 'failed',
    runtimeState: options.runtimeState || 'blocked',
    operation: 'indexeddb_recovery',
    issues: [error instanceof Error ? error.message : 'Recovery failed'],
    context: options.context,
  });
};

export const recordIndexedDbFallbackMode = (
  errorName: string,
  errorMessage: string,
  context?: Record<string, unknown>
): void => {
  recordOperationalTelemetry({
    category: 'indexeddb',
    status: 'degraded',
    runtimeState: 'recoverable',
    operation: 'indexeddb_fallback_mode',
    issues: [errorMessage || 'IndexedDB fallback activated'],
    context: { errorName, ...context },
  });
};

export const recordIndexedDbRecoveryNotice = (
  operation: string,
  issue: string,
  context?: Record<string, unknown>,
  runtimeState: OperationalRuntimeState = 'degraded'
): void => {
  recordOperationalTelemetry({
    category: 'indexeddb',
    status: runtimeState === 'blocked' ? 'failed' : 'degraded',
    runtimeState,
    operation,
    issues: [issue],
    context,
  });
};
