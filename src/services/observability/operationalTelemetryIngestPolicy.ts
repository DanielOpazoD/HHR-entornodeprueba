/**
 * Server-side acceptance policy for operational telemetry sent by the browser.
 *
 * The endpoint is reached through `navigator.sendBeacon`, which cannot carry an Authorization
 * header, so it is unauthenticated by design. Everything that enters is therefore treated as
 * untrusted: shape is validated, sizes are capped, and any key that could carry patient data is
 * dropped before the event is logged or mailed. Telemetry describes the system, never a patient.
 */
import { z } from 'zod';

export const OPERATIONAL_TELEMETRY_MAX_BODY_BYTES = 8 * 1024;
const MAX_STRING = 200;
const MAX_ISSUES = 10;
const MAX_CONTEXT_KEYS = 20;

const CATEGORIES = [
  'auth',
  'daily_record',
  'firestore',
  'sync',
  'indexeddb',
  'integration',
  'export',
  'backup',
  'reminders',
  'transfers',
  'clinical_document',
  'create_day',
  'handoff',
  'prescription',
] as const;
const STATUSES = ['success', 'partial', 'degraded', 'failed'] as const;

/** Keys that could name or identify a patient never leave the browser through this channel. */
const SENSITIVE_KEY =
  /rut|name|nombre|patient|paciente|diagn|bed|cama|episod|enc(ounter)?Id|email|phone|tel|token|auth|password|secret/i;

const clip = (value: string): string =>
  value.length > MAX_STRING ? `${value.slice(0, MAX_STRING - 1)}…` : value;

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const eventSchema = z.object({
  category: z.enum(CATEGORIES),
  status: z.enum(STATUSES),
  operation: z.string().min(1).max(80),
  timestamp: z.string().datetime({ offset: true }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  runtimeState: z.string().max(40).optional(),
  issues: z
    .array(z.string().max(MAX_STRING * 2))
    .max(MAX_ISSUES)
    .optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const envelopeSchema = z.object({
  source: z.literal('hhr_operational_telemetry'),
  event: eventSchema,
});

export interface SanitizedOperationalTelemetryEvent {
  category: (typeof CATEGORIES)[number];
  status: (typeof STATUSES)[number];
  operation: string;
  timestamp: string;
  date?: string;
  runtimeState?: string;
  issues: string[];
  context: Record<string, string | number | boolean | null>;
  droppedContextKeys: string[];
}

export type OperationalTelemetryIngestResult =
  | { ok: true; event: SanitizedOperationalTelemetryEvent }
  | { ok: false; reason: 'too_large' | 'invalid_json' | 'invalid_shape' };

export const sanitizeOperationalTelemetryContext = (
  context: Record<string, unknown> | undefined
): { context: Record<string, string | number | boolean | null>; dropped: string[] } => {
  const out: Record<string, string | number | boolean | null> = {};
  const dropped: string[] = [];
  for (const [key, raw] of Object.entries(context ?? {})) {
    if (Object.keys(out).length >= MAX_CONTEXT_KEYS) {
      dropped.push(key);
      continue;
    }
    if (SENSITIVE_KEY.test(key)) {
      dropped.push(key);
      continue;
    }
    const parsed = primitive.safeParse(raw);
    if (!parsed.success) {
      dropped.push(key);
      continue;
    }
    out[key] = typeof parsed.data === 'string' ? clip(parsed.data) : parsed.data;
  }
  return { context: out, dropped };
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
  const { event } = parsed.data;
  const { context, dropped } = sanitizeOperationalTelemetryContext(event.context);
  return {
    ok: true,
    event: {
      category: event.category,
      status: event.status,
      operation: event.operation,
      timestamp: event.timestamp,
      date: event.date,
      runtimeState: event.runtimeState,
      issues: (event.issues ?? []).map(clip),
      context,
      droppedContextKeys: dropped,
    },
  };
};

/** Only outcomes that need a human are mailed; everything else is just logged. */
export const shouldAlertOperationalTelemetry = (
  event: Pick<SanitizedOperationalTelemetryEvent, 'status' | 'operation'>
): boolean =>
  event.status === 'failed' || (event.status === 'partial' && event.operation === 'rayen_sync_run');

export const buildOperationalTelemetryAlert = (
  event: SanitizedOperationalTelemetryEvent,
  siteLabel: string
): { subject: string; body: string } => {
  const statusLabel = event.status === 'failed' ? 'FALLO' : 'PARCIAL';
  const subject = `[HHR] ${statusLabel} · ${event.operation} · ${event.date ?? event.timestamp.slice(0, 10)}`;
  const lines = [
    `Sitio: ${siteLabel}`,
    `Operación: ${event.operation} (${event.category})`,
    `Estado: ${event.status}`,
    `Momento: ${event.timestamp}`,
    event.date ? `Día clínico: ${event.date}` : null,
    event.runtimeState ? `Runtime: ${event.runtimeState}` : null,
    '',
    event.issues.length ? 'Incidencias:' : 'Sin incidencias detalladas.',
    ...event.issues.map(issue => `- ${issue}`),
    '',
    'Contexto (sin datos de pacientes):',
    ...Object.entries(event.context).map(([key, value]) => `- ${key}: ${String(value)}`),
    '',
    'Revisa Observabilidad → Servicios externos en HHR para el detalle local.',
  ].filter((line): line is string => line !== null);
  return { subject, body: lines.join('\n') };
};
