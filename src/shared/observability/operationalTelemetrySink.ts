import type { OperationalTelemetryEvent } from '@/services/observability/operationalTelemetryTypes';

export type OperationalTelemetrySink = (
  input: Omit<OperationalTelemetryEvent, 'timestamp'>,
  options?: { allowSuccess?: boolean }
) => void;

let registeredOperationalTelemetrySink: OperationalTelemetrySink | null = null;

/**
 * Registers the runtime sink that records operational telemetry from pure core modules
 * (`schemas/`, `utils/`) without creating upward imports into `services/observability/`.
 */
export const registerOperationalTelemetrySink = (sink: OperationalTelemetrySink): void => {
  registeredOperationalTelemetrySink = sink;
};

export const emitOperationalTelemetry = (
  input: Omit<OperationalTelemetryEvent, 'timestamp'>,
  options?: { allowSuccess?: boolean }
): void => {
  registeredOperationalTelemetrySink?.(input, options);
};
