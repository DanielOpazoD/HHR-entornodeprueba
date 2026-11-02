import { dispatchOperationalTelemetryExternally } from '@/services/observability/operationalTelemetryExternalAdapter';
import { saveErrorLog } from '@/services/storage/indexeddb/indexedDbErrorLogService';
import type { ErrorLog } from '@/services/logging/errorLogTypes';
import { errorServiceSinksLogger } from '@/services/utils/errorLoggers';

export type ErrorServiceSink = (errorLog: ErrorLog) => Promise<void> | void;

export interface ErrorServiceSinkOptions {
  allowDevConsole?: boolean;
}

export const createDevConsoleErrorSink =
  (enabled: boolean): ErrorServiceSink =>
  errorLog => {
    if (!enabled) return;
    errorServiceSinksLogger.error('Captured error service log', errorLog);
  };

export const indexedDbErrorSink: ErrorServiceSink = async errorLog => {
  await saveErrorLog(errorLog);
};

const mapSeverityToTelemetryStatus = (severity: ErrorLog['severity']): 'degraded' | 'failed' =>
  severity === 'critical' || severity === 'high' ? 'failed' : 'degraded';

const ERROR_SOURCE_BY_TYPE: Record<string, string> = {
  unhandledrejection: 'unhandled_rejection',
  error: 'uncaught_error',
  error_boundary: 'render_crash',
};

const stringField = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/**
 * The message never leaves the device, so the alert needs codes that say what failed: where the
 * error surfaced, its class and its Firebase code. The sanitizer keeps only values it knows.
 */
const describeErrorCause = (context: ErrorLog['context']): Record<string, string> => {
  const reason =
    context?.reason && typeof context.reason === 'object'
      ? (context.reason as Record<string, unknown>)
      : {};
  const errorName = stringField(context?.errorName) ?? stringField(reason.name);
  const errorCode =
    stringField(context?.errorCode) ??
    stringField(reason.code) ??
    stringField(context?.firebaseCode);
  return {
    errorSource: ERROR_SOURCE_BY_TYPE[stringField(context?.type) ?? ''] ?? 'logged',
    ...(errorName ? { errorName } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
};

export const externalTelemetryErrorSink: ErrorServiceSink = async errorLog => {
  await dispatchOperationalTelemetryExternally({
    category: 'sync',
    status: mapSeverityToTelemetryStatus(errorLog.severity),
    operation: 'error_service_log',
    timestamp: errorLog.timestamp,
    issues: [errorLog.message],
    context: describeErrorCause(errorLog.context),
  });
};

export const createSafeErrorServiceSink = (
  label: string,
  sink: ErrorServiceSink
): ErrorServiceSink => {
  return async errorLog => {
    try {
      await sink(errorLog);
    } catch (error) {
      errorServiceSinksLogger.error(`Failed in sink ${label}`, error);
    }
  };
};

export const buildDefaultErrorServiceSinks = (
  options: ErrorServiceSinkOptions = {}
): ErrorServiceSink[] => [
  createDevConsoleErrorSink(Boolean(options.allowDevConsole)),
  createSafeErrorServiceSink('indexeddb', indexedDbErrorSink),
  // Errors are not clinical traceability: they stay in the local error log and telemetry.
  createSafeErrorServiceSink('external-telemetry', externalTelemetryErrorSink),
];

export const runErrorServiceSinks = async (
  errorLog: ErrorLog,
  sinks: ErrorServiceSink[]
): Promise<void> => {
  for (const sink of sinks) {
    await sink(errorLog);
  }
};
