import type { OperationalTelemetryOperation } from '@/services/observability/operationalTelemetryOperations';
import {
  createOperationalError,
  normalizeOperationalError,
  type OperationalError,
  type OperationalErrorShape,
} from '@/services/observability/operationalError';
import { createDomainObservability } from '@/services/observability/domainObservability';
import {
  toOperationalTelemetryStatus,
  type OperationalRuntimeState,
} from '@/services/observability/operationalRuntimeState';

const authObservability = createDomainObservability('auth', 'Auth');

export const recordAuthOperationalError = (
  operation: OperationalTelemetryOperation,
  error: unknown,
  fallback: OperationalErrorShape,
  options: { context?: Record<string, unknown> } = {}
): OperationalError => authObservability.recordError(operation, error, fallback, options);

export const emitAuthOperationalEvent = (
  operation: OperationalTelemetryOperation,
  runtimeState: OperationalRuntimeState,
  input: OperationalErrorShape
): OperationalError => {
  const operationalError = normalizeOperationalError(createOperationalError(input), input);
  authObservability.recordEvent(operation, toOperationalTelemetryStatus(runtimeState), {
    runtimeState,
    context: {
      errorCode: operationalError.code,
      ...operationalError.context,
    },
    issues: [operationalError.userSafeMessage || operationalError.message],
  });
  return operationalError;
};
