/**
 * Receiver for browser operational telemetry (`VITE_OPERATIONAL_TELEMETRY_ENDPOINT`).
 *
 * Same-origin by design so `navigator.sendBeacon` works without CSP changes. Every accepted
 * event is written as one structured log line (Netlify function logs) and, when it describes a
 * failure that needs a human, mailed to `OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS` through the
 * Gmail sender the census already uses. Alerts are throttled per operation to avoid storms.
 */
import { sendCensusEmail } from '../../src/services/email/gmailClient';
import {
  buildOperationalTelemetryAlert,
  parseOperationalTelemetryBody,
  shouldAlertOperationalTelemetry,
  type SanitizedOperationalTelemetryEvent,
} from '../../src/services/observability/operationalTelemetryIngestPolicy';
import { validateGmailEnv } from './lib/envValidator';
import {
  buildCorsHeaders,
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  type NetlifyEventLike,
} from './lib/http';

export const OPERATIONAL_TELEMETRY_ALERT_THROTTLE_MS = 10 * 60 * 1000;
const RATE_LIMIT = { maxPerWindow: 60, windowMs: 60_000 };

export interface OperationalTelemetryHandlerDeps {
  sendEmail: (params: {
    date: string;
    recipients: string[];
    subject: string;
    body: string;
  }) => Promise<unknown>;
  gmailConfigured: () => boolean;
  now: () => number;
  log: (line: string) => void;
  env: () => NodeJS.ProcessEnv;
}

const parseRecipients = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(/[,;\s]+/)
    .map(value => value.trim())
    .filter(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));

export const createOperationalTelemetryHandler = (deps: OperationalTelemetryHandlerDeps) => {
  const lastAlertByOperation = new Map<string, number>();

  const maybeAlert = async (event: SanitizedOperationalTelemetryEvent): Promise<string> => {
    if (!shouldAlertOperationalTelemetry(event)) return 'not_alertable';
    const recipients = parseRecipients(deps.env().OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS);
    if (recipients.length === 0) return 'no_recipients';
    if (!deps.gmailConfigured()) return 'gmail_not_configured';
    const last = lastAlertByOperation.get(event.operation) ?? 0;
    const now = deps.now();
    if (now - last < OPERATIONAL_TELEMETRY_ALERT_THROTTLE_MS) return 'throttled';
    lastAlertByOperation.set(event.operation, now);
    const siteLabel = deps.env().URL || deps.env().SITE_URL || 'HHR';
    const { subject, body } = buildOperationalTelemetryAlert(event, siteLabel);
    try {
      await deps.sendEmail({
        date: event.date ?? event.timestamp.slice(0, 10),
        recipients,
        subject,
        body,
      });
      return 'sent';
    } catch (error) {
      deps.log(
        JSON.stringify({
          source: 'operational-telemetry',
          kind: 'alert_error',
          operation: event.operation,
          message: error instanceof Error ? error.message : String(error),
        })
      );
      return 'send_failed';
    }
  };

  return async (event: NetlifyEventLike) => {
    const requestOrigin = getRequestOrigin(event);
    const corsHeaders = buildCorsHeaders(requestOrigin, {
      allowedHeaders: 'Content-Type',
      allowedMethods: 'POST,OPTIONS',
    });
    if (!isOriginAllowed(requestOrigin)) {
      return buildJsonResponse(403, { error: 'Origin not allowed' }, { requestOrigin });
    }
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: corsHeaders, body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return buildJsonResponse(405, { error: 'Method not allowed' }, { requestOrigin });
    }
    if (isRateLimited(getClientIp(event), RATE_LIMIT)) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    const parsed = parseOperationalTelemetryBody(event.body);
    if (!parsed.ok) {
      const status = parsed.reason === 'too_large' ? 413 : 400;
      return buildJsonResponse(status, { error: parsed.reason }, { requestOrigin });
    }

    const alert = await maybeAlert(parsed.event);
    deps.log(
      JSON.stringify({
        source: 'operational-telemetry',
        kind: 'event',
        receivedAt: new Date(deps.now()).toISOString(),
        origin: requestOrigin ?? null,
        alert,
        event: parsed.event,
      })
    );
    return buildJsonResponse(202, { accepted: true, alert }, { requestOrigin });
  };
};

export const handler = createOperationalTelemetryHandler({
  sendEmail: params => sendCensusEmail(params),
  gmailConfigured: () => validateGmailEnv().valid,
  now: () => Date.now(),
  // Structured JSON lines are the durable record in Netlify function logs; info level on purpose.
  // eslint-disable-next-line no-console
  log: line => console.info(line),
  env: () => process.env,
});
