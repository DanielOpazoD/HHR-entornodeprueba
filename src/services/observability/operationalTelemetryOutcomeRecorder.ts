import type { OperationalTelemetryOperation } from '@/services/observability/operationalTelemetryOperations';
import type { OperationalOutcomeLike } from '@/services/observability/operationalTelemetryContracts';
import type {
  OperationalTelemetryCategory,
  OperationalTelemetryEvent,
} from '@/services/observability/operationalTelemetryTypes';
import {
  normalizeOperationalError,
  type OperationalError,
  type OperationalErrorShape,
} from '@/services/observability/operationalError';
import {
  toOperationalTelemetryStatus,
  type OperationalRuntimeState,
} from '@/services/observability/operationalRuntimeState';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

interface OperationalTelemetryRecordOptions {
  date?: string;
  context?: Record<string, unknown>;
}

type OperationalTelemetryEventInput = Omit<OperationalTelemetryEvent, 'timestamp'>;

interface OperationalTelemetryOutcomeRecordOptions extends OperationalTelemetryRecordOptions {
  allowSuccess?: boolean;
}

interface OperationalErrorTelemetryBuildResult {
  operationalError: OperationalError;
  telemetryEvent: OperationalTelemetryEventInput;
}

const resolveIssueMessage = (issue: unknown): string => {
  if (issue && typeof issue === 'object' && 'message' in issue) {
    const message = issue as { message?: unknown };
    return typeof message.message === 'string' ? message.message : 'Sin detalle';
  }

  return 'Sin detalle';
};

const deriveRuntimeStateFromSeverity = (
  severity: OperationalErrorShape['severity']
): OperationalRuntimeState => {
  if (severity === 'warning' || severity === 'info') {
    return 'degraded';
  }

  return 'blocked';
};

const buildOperationalOutcomeTelemetryEvent = (
  category: OperationalTelemetryCategory,
  operation: OperationalTelemetryOperation,
  outcome: OperationalOutcomeLike,
  options: OperationalTelemetryRecordOptions = {}
): OperationalTelemetryEventInput => ({
  category,
  operation,
  status: outcome.status,
  date: options.date,
  context: options.context,
  issues: (outcome.issues || []).map(resolveIssueMessage),
});

const buildOperationalErrorTelemetryEvent = (
  category: OperationalTelemetryCategory,
  operation: OperationalTelemetryOperation,
  error: unknown,
  fallback: OperationalErrorShape,
  options: OperationalTelemetryRecordOptions = {}
): OperationalErrorTelemetryBuildResult => {
  const operationalError = normalizeOperationalError(error, fallback);
  const runtimeState =
    operationalError.runtimeState || deriveRuntimeStateFromSeverity(operationalError.severity);

  return {
    operationalError,
    telemetryEvent: {
      category,
      operation,
      status: toOperationalTelemetryStatus(runtimeState),
      runtimeState,
      date: options.date,
      context: {
        errorCode: operationalError.code,
        ...operationalError.context,
        ...options.context,
      },
      issues: [operationalError.userSafeMessage || operationalError.message],
    },
  };
};

export const recordOperationalOutcome = (
  category: OperationalTelemetryCategory,
  operation: OperationalTelemetryOperation,
  outcome: OperationalOutcomeLike,
  options: OperationalTelemetryOutcomeRecordOptions = {}
): void => {
  recordOperationalTelemetry(
    buildOperationalOutcomeTelemetryEvent(category, operation, outcome, options),
    { allowSuccess: options.allowSuccess }
  );
};

export const recordOperationalErrorTelemetry = (
  category: OperationalTelemetryCategory,
  operation: OperationalTelemetryOperation,
  error: unknown,
  fallback: OperationalErrorShape,
  options: OperationalTelemetryRecordOptions = {}
) => {
  const { operationalError, telemetryEvent } = buildOperationalErrorTelemetryEvent(
    category,
    operation,
    error,
    fallback,
    options
  );

  recordOperationalTelemetry(telemetryEvent);

  return operationalError;
};

export const __testing = {
  buildOperationalOutcomeTelemetryEvent,
  buildOperationalErrorTelemetryEvent,
  deriveRuntimeStateFromSeverity,
};
