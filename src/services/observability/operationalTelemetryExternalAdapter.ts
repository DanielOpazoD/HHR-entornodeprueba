import type {
  OperationalTelemetryEvent,
  OperationalTelemetryStatus,
} from '@/services/observability/operationalTelemetryTypes';

export interface OperationalTelemetryExternalConfig {
  enabled: boolean;
  endpoint?: string;
  sampleRate: number;
}

const DEFAULT_SAMPLE_RATE = 1;

const normalizeSampleRate = (raw: string | undefined): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_RATE;
  return Math.max(0, Math.min(1, parsed));
};

export const resolveOperationalTelemetryExternalConfig = (): OperationalTelemetryExternalConfig => {
  const endpoint = import.meta.env.VITE_OPERATIONAL_TELEMETRY_ENDPOINT?.trim();
  const sampleRate = normalizeSampleRate(import.meta.env.VITE_OPERATIONAL_TELEMETRY_SAMPLE_RATE);

  return {
    enabled: Boolean(endpoint),
    endpoint: endpoint || undefined,
    sampleRate,
  };
};

const shouldSampleStatus = (status: OperationalTelemetryStatus, sampleRate: number): boolean => {
  if (status === 'failed') return true;
  if (sampleRate >= 1) return true;
  return Math.random() <= sampleRate;
};

/**
 * The recorded event still holds raw `Error.message` text and arbitrary context for the local
 * Observability panel. Nothing of that may reach the network, so the shared sanitizer runs here,
 * before the beacon is built, and the server runs it again on whatever arrives.
 */
const buildPayload = async (event: OperationalTelemetryEvent): Promise<string> => {
  const { sanitizeOperationalTelemetryEvent } = await import('./operationalTelemetryPrivacy');
  return JSON.stringify({
    source: 'hhr_operational_telemetry',
    event: sanitizeOperationalTelemetryEvent(event),
  });
};

const sendWithBeacon = (endpoint: string, payload: string): boolean => {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return false;
  }

  try {
    return navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
  } catch {
    return false;
  }
};

const sendWithFetch = async (endpoint: string, payload: string): Promise<void> => {
  if (typeof fetch !== 'function') throw new Error('telemetry_transport_unavailable');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  });
  if (!response.ok) throw new Error('telemetry_not_accepted');
};

export const dispatchOperationalTelemetryExternally = async (
  event: OperationalTelemetryEvent,
  config: OperationalTelemetryExternalConfig = resolveOperationalTelemetryExternalConfig()
): Promise<boolean> => {
  if (!config.enabled || !config.endpoint) {
    return false;
  }
  if (!shouldSampleStatus(event.status, config.sampleRate)) {
    return false;
  }

  try {
    const payload = await buildPayload(event);
    if (sendWithBeacon(config.endpoint, payload)) return true;
    await sendWithFetch(config.endpoint, payload);
    return true;
  } catch {
    return false;
  }
};

/**
 * Controlled end-to-end check of the alert channel. It carries no incident and no context, and the
 * alert mail announces itself as a PRUEBA CONTROLADA so nobody mistakes it for a real failure.
 */
export const dispatchOperationalTelemetryDeliveryProbe = (
  config: OperationalTelemetryExternalConfig = resolveOperationalTelemetryExternalConfig()
): Promise<boolean> =>
  import('./operationalTelemetryPrivacy').then(({ OPERATIONAL_TELEMETRY_PROBE_OPERATION }) =>
    dispatchOperationalTelemetryExternally(
      {
        category: 'integration',
        status: 'failed',
        operation: OPERATIONAL_TELEMETRY_PROBE_OPERATION,
        timestamp: new Date().toISOString(),
      },
      config
    )
  );
