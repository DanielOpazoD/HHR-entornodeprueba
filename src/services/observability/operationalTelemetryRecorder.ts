import type { OperationalTelemetrySummary } from '@/services/observability/operationalTelemetryContracts';
import type {
  OperationalTelemetryEvent,
  OperationalTelemetryStatus,
} from '@/services/observability/operationalTelemetryTypes';
import { dispatchOperationalTelemetryExternally } from '@/services/observability/operationalTelemetryExternalAdapter';
import { buildOperationalTelemetrySummary } from '@/services/observability/operationalTelemetrySummary';
import {
  persistOperationalTelemetryEvents,
  readOperationalTelemetryEvents,
} from '@/services/observability/operationalTelemetryStore';
import {
  createRecordedOperationalTelemetryEvent,
  OPERATIONAL_TELEMETRY_DEFAULT_WINDOW_MS,
} from '@/services/observability/operationalTelemetrySupport';
import { createScopedLogger } from '@/services/utils/loggerScope';

const operationalTelemetryLogger = createScopedLogger('OperationalTelemetry');

const readOperationalTelemetryEventsSafely = (): OperationalTelemetryEvent[] =>
  readOperationalTelemetryEvents({
    onReadError: error => operationalTelemetryLogger.warn('Failed to read persisted events', error),
  });

const persistOperationalTelemetryEventsSafely = (events: OperationalTelemetryEvent[]): void => {
  persistOperationalTelemetryEvents(events, {
    onPersistError: error => operationalTelemetryLogger.warn('Failed to persist events', error),
  });
};

export const shouldRecordOperationalTelemetry = (
  status: OperationalTelemetryStatus,
  options: { allowSuccess?: boolean } = {}
): boolean => {
  if (status === 'failed') return true;
  if (status === 'partial' || status === 'degraded') return true;
  return !!options.allowSuccess;
};

export const recordOperationalTelemetry = (
  input: Omit<OperationalTelemetryEvent, 'timestamp'>,
  options: { allowSuccess?: boolean } = {}
): void => {
  if (!shouldRecordOperationalTelemetry(input.status, options)) {
    return;
  }

  const event = createRecordedOperationalTelemetryEvent(input);
  const nextEvents = [...readOperationalTelemetryEventsSafely(), event];

  persistOperationalTelemetryEventsSafely(nextEvents);
  void dispatchOperationalTelemetryExternally(event);
};

export const getOperationalTelemetryEvents = (): OperationalTelemetryEvent[] =>
  readOperationalTelemetryEventsSafely();

export const clearOperationalTelemetryEvents = (): void => {
  persistOperationalTelemetryEventsSafely([]);
};

export const getOperationalTelemetrySummary = (
  windowMs: number = OPERATIONAL_TELEMETRY_DEFAULT_WINDOW_MS
): OperationalTelemetrySummary =>
  buildOperationalTelemetrySummary(getOperationalTelemetryEvents(), windowMs);
