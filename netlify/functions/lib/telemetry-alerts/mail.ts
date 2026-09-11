import { DEFAULT_GMAIL_SENDER, sendCensusEmail } from '../../../../src/services/email/gmailClient';
import {
  buildOperationalTelemetryAlert,
  type SanitizedOperationalTelemetryEvent,
} from '../../../../src/services/observability/operationalTelemetryIngestPolicy';

export type AlertMailOutcome = {
  kind: 'sent' | 'retryable' | 'permanent' | 'uncertain';
  code:
    | 'accepted'
    | 'provider_rate_limited'
    | 'provider_rejected'
    | 'delivery_unconfirmed'
    | 'mail_not_configured';
};
export const ALERT_MAIL_TIMEOUT_MS = 8_000;
const EMAIL = /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/;

export const resolveAlertMailbox = (env: NodeJS.ProcessEnv) => {
  const recipients = (env.OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS ?? '')
    .split(/[,;\s]+/)
    .filter(Boolean);
  const address = env.OPERATIONAL_TELEMETRY_ALERT_SENDER?.trim();
  const token = env.OPERATIONAL_TELEMETRY_GMAIL_REFRESH_TOKEN?.trim();
  // A half-configured dedicated mailbox must not silently change the sender.
  if (Boolean(address) !== Boolean(token)) return null;
  if (!recipients.length || recipients.length > 5 || recipients.some(value => !EMAIL.test(value)))
    return null;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !(token || env.GMAIL_REFRESH_TOKEN))
    return null;
  if (address && !EMAIL.test(address)) return null;
  return {
    recipients,
    sender: address
      ? {
          name: env.OPERATIONAL_TELEMETRY_ALERT_SENDER_NAME?.trim() || 'HHR Alertas',
          email: address,
        }
      : DEFAULT_GMAIL_SENDER,
    refreshToken: token || undefined,
  };
};

/** Never persist provider Error.message: it may contain request payloads or credentials. */
export const classifyAlertMailError = (error: unknown): AlertMailOutcome => {
  const response =
    error && typeof error === 'object' && 'response' in error ? error.response : null;
  const status =
    response && typeof response === 'object' && 'status' in response ? response.status : null;
  // A documented explicit rejection is safe to retry. 5xx/network failures are NOT evidence
  // Gmail did not accept the message. Do not blindly retry a possibly delivered clinical alert.
  if (status === 429) return { kind: 'retryable', code: 'provider_rate_limited' };
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return { kind: 'permanent', code: 'provider_rejected' };
  }
  return { kind: 'uncertain', code: 'delivery_unconfirmed' };
};

export const createAlertMailer =
  (deps: {
    env: () => NodeJS.ProcessEnv;
    sendEmail?: typeof sendCensusEmail;
    timeoutMs?: number;
  }) =>
  async (event: SanitizedOperationalTelemetryEvent, id: string): Promise<AlertMailOutcome> => {
    const env = deps.env();
    const mailbox = resolveAlertMailbox(env);
    if (!mailbox) return { kind: 'permanent', code: 'mail_not_configured' };
    const { subject, body } = buildOperationalTelemetryAlert(event, env.URL || 'HHR');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutMs = deps.timeoutMs ?? ALERT_MAIL_TIMEOUT_MS;
      await Promise.race([
        (deps.sendEmail ?? sendCensusEmail)({
          date: event.date ?? event.timestamp.slice(0, 10),
          ...mailbox,
          subject,
          body: `${body}\n\nReferencia de entrega: ${id}`,
          deliveryOptions: { timeoutMs, messageId: `<hhr-alert-${id}@hospitalhangaroa.cl>` },
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('delivery_unconfirmed')), timeoutMs);
        }),
      ]);
      return { kind: 'sent', code: 'accepted' };
    } catch (error) {
      return classifyAlertMailError(error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
