/**
 * Server-side acceptance policy for operational telemetry sent by the browser.
 *
 * The endpoint is reached through `navigator.sendBeacon`, which cannot carry an Authorization
 * header, so it is unauthenticated by design. Everything that enters is therefore treated as
 * untrusted: the body size is capped, the shape is validated, and the result is then pushed
 * through the shared privacy sanitizer a second time — the browser adapter already sanitized
 * before sending, but a hand-crafted POST never went through that adapter.
 *
 * Telemetry describes the system, never a patient. After sanitizing there is no free text left:
 * issues are stable codes, context is an allowlist of bounded values, and the operation is a known
 * literal or the generic bucket.
 */
import { z } from 'zod';

import {
  OPERATIONAL_TELEMETRY_CATEGORIES,
  OPERATIONAL_TELEMETRY_DROPPED_KEY_TOKEN,
  OPERATIONAL_TELEMETRY_MAX_CONTEXT_KEYS,
  OPERATIONAL_TELEMETRY_MAX_ISSUES,
  OPERATIONAL_TELEMETRY_PROBE_OPERATION,
  OPERATIONAL_TELEMETRY_STATUSES,
  sanitizeOperationalTelemetryContextValues,
  sanitizeOperationalTelemetryEvent,
  type OperationalTelemetryContextValue,
} from './operationalTelemetryPrivacy';

export const OPERATIONAL_TELEMETRY_MAX_BODY_BYTES = 8 * 1024;
const MAX_STRING = 200;

const eventSchema = z.object({
  category: z.enum(OPERATIONAL_TELEMETRY_CATEGORIES),
  status: z.enum(OPERATIONAL_TELEMETRY_STATUSES),
  operation: z.string().min(1).max(80),
  timestamp: z.string().datetime({ offset: true }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  runtimeState: z.string().max(40).optional(),
  issues: z
    .array(z.string().max(MAX_STRING * 2))
    .max(OPERATIONAL_TELEMETRY_MAX_ISSUES)
    .optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const envelopeSchema = z.object({
  source: z.literal('hhr_operational_telemetry'),
  event: eventSchema,
});

export interface SanitizedOperationalTelemetryEvent {
  category: (typeof OPERATIONAL_TELEMETRY_CATEGORIES)[number];
  status: (typeof OPERATIONAL_TELEMETRY_STATUSES)[number];
  operation: string;
  timestamp: string;
  date?: string;
  runtimeState?: string;
  issues: string[];
  context: Record<string, OperationalTelemetryContextValue>;
  droppedContextKeys: string[];
}

export type OperationalTelemetryIngestResult =
  | { ok: true; event: SanitizedOperationalTelemetryEvent }
  | { ok: false; reason: 'too_large' | 'invalid_json' | 'invalid_shape' };

/**
 * Kept for callers that only need the context gate. Rejected keys are reported as opaque tokens:
 * the key name itself is attacker-controlled input and must not be echoed back into a log or mail.
 */
export const sanitizeOperationalTelemetryContext = (
  context: Record<string, unknown> | undefined
): { context: Record<string, OperationalTelemetryContextValue>; dropped: string[] } => {
  const { context: kept, droppedCount } = sanitizeOperationalTelemetryContextValues(context);
  return {
    context: kept,
    dropped: Array.from(
      { length: Math.min(droppedCount, OPERATIONAL_TELEMETRY_MAX_CONTEXT_KEYS) },
      () => OPERATIONAL_TELEMETRY_DROPPED_KEY_TOKEN
    ),
  };
};

export const parseOperationalTelemetryBody = (
  body: string | null | undefined
): OperationalTelemetryIngestResult => {
  if (!body) return { ok: false, reason: 'invalid_json' };
  if (Buffer.byteLength(body, 'utf8') > OPERATIONAL_TELEMETRY_MAX_BODY_BYTES) {
    return { ok: false, reason: 'too_large' };
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'invalid_shape' };
  // Shape first, privacy second: validation proves the envelope, sanitizing decides what survives.
  return { ok: true, event: sanitizeOperationalTelemetryEvent(parsed.data.event) };
};

/** Only outcomes that need a human are mailed; everything else is just logged. */
export const shouldAlertOperationalTelemetry = (
  event: Pick<SanitizedOperationalTelemetryEvent, 'status' | 'operation'>
): boolean =>
  event.operation === OPERATIONAL_TELEMETRY_PROBE_OPERATION ||
  event.status === 'failed' ||
  (event.status === 'partial' && event.operation === 'rayen_sync_run');

const PRIVACY_NOTE =
  'Por privacidad, los mensajes de error detallados NO salen del dispositivo: quedan solo en el ' +
  'navegador. Revisa Observabilidad → Servicios externos en HHR para el detalle local.';

export const buildOperationalTelemetryAlert = (
  event: SanitizedOperationalTelemetryEvent,
  siteLabel: string
): { subject: string; body: string } => {
  const isProbe = event.operation === OPERATIONAL_TELEMETRY_PROBE_OPERATION;
  const statusLabel = isProbe
    ? 'PRUEBA CONTROLADA'
    : event.status === 'failed'
      ? 'FALLO'
      : 'PARCIAL';
  const subject = `[HHR] ${statusLabel} · ${event.operation} · ${event.date ?? event.timestamp.slice(0, 10)}`;
  const lines = [
    isProbe
      ? 'PRUEBA CONTROLADA del canal de alertas. No corresponde a un incidente clínico ni operacional.'
      : null,
    isProbe ? '' : null,
    `Sitio: ${siteLabel}`,
    `Operación: ${event.operation} (${event.category})`,
    `Estado: ${event.status}`,
    `Momento: ${event.timestamp}`,
    event.date ? `Día clínico: ${event.date}` : null,
    event.runtimeState ? `Runtime: ${event.runtimeState}` : null,
    '',
    event.issues.length
      ? 'Códigos de incidencia (sin texto libre):'
      : 'Sin incidencias detalladas.',
    ...event.issues.map(issue => `- ${issue}`),
    '',
    'Contexto operacional (sin datos de pacientes):',
    ...Object.entries(event.context).map(([key, value]) => `- ${key}: ${String(value)}`),
    `- claves de contexto descartadas: ${event.droppedContextKeys.length}`,
    '',
    PRIVACY_NOTE,
  ].filter((line): line is string => line !== null);
  return { subject, body: lines.join('\n') };
};
