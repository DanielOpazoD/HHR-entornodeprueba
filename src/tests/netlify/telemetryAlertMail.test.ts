import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyAlertMailError,
  createAlertMailer,
  resolveAlertMailbox,
} from '../../../netlify/functions/lib/telemetry-alerts/mail';
import { sendCensusEmail } from '../../../src/services/email/gmailClient';
import type { SanitizedOperationalTelemetryEvent } from '../../../src/services/observability/operationalTelemetryIngestPolicy';
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials = vi.fn();
      },
    },
    gmail: () => ({ users: { messages: { send: mocks.send } } }),
  },
}));
const env = {
  GMAIL_CLIENT_ID: 'test-client',
  GMAIL_CLIENT_SECRET: 'test-secret',
  GMAIL_REFRESH_TOKEN: 'test-refresh',
  OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS: 'recipient@example.com',
};
const event: SanitizedOperationalTelemetryEvent = {
  category: 'integration',
  status: 'failed',
  operation: 'telemetry_delivery_probe',
  timestamp: '2026-09-11T16:00:00.000Z',
  context: {},
  issues: [],
  droppedContextKeys: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ data: { id: 'provider-id' } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('operational alert delivery policy', () => {
  it('keeps the shared sender by default but fails closed on a half configured dedicated mailbox', () => {
    expect(resolveAlertMailbox(env)?.sender.email).toBe('hospitalizados@hospitalhangaroa.cl');
    expect(
      resolveAlertMailbox({ ...env, OPERATIONAL_TELEMETRY_ALERT_SENDER: 'daniel@example.com' })
    ).toBeNull();
    expect(
      resolveAlertMailbox({ ...env, OPERATIONAL_TELEMETRY_GMAIL_REFRESH_TOKEN: 'other-token' })
    ).toBeNull();
  });
  it('uses dedicated credentials without requiring the shared mailbox token', () => {
    const config = resolveAlertMailbox({
      ...env,
      GMAIL_REFRESH_TOKEN: '',
      OPERATIONAL_TELEMETRY_ALERT_SENDER: 'daniel@example.com',
      OPERATIONAL_TELEMETRY_GMAIL_REFRESH_TOKEN: 'other-token',
    });
    expect(config?.sender.email).toBe('daniel@example.com');
    expect(config?.refreshToken).toBe('other-token');
  });
  it.each(['bad-address', 'a@example.com\r\nBcc: stranger@example.com'])(
    'rejects unsafe configured addresses: %s',
    value => {
      expect(
        resolveAlertMailbox({ ...env, OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS: value })
      ).toBeNull();
    }
  );
  it.each([400, 401, 403, 404])('does not retry an explicit permanent rejection %s', status => {
    expect(
      classifyAlertMailError({ response: { status }, message: 'secret-provider-payload' })
    ).toEqual({ kind: 'permanent', code: 'provider_rejected' });
  });
  it('retries only an explicit quota rejection, not unknown failures or HTTP 5xx', () => {
    expect(classifyAlertMailError({ response: { status: 429 } }).kind).toBe('retryable');
    expect(classifyAlertMailError({ response: { status: 503 } }).kind).toBe('uncertain');
    expect(classifyAlertMailError(new Error('possibly accepted'))).toEqual({
      kind: 'uncertain',
      code: 'delivery_unconfirmed',
    });
  });
  it('returns a safe durable outcome when mail configuration is absent', async () => {
    const sendEmail = vi.fn();
    const result = await createAlertMailer({ env: () => ({}), sendEmail })(event, 'id-1');
    expect(result).toEqual({ kind: 'permanent', code: 'mail_not_configured' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('bounds a hung request and treats it as uncertain rather than retryable', async () => {
    vi.useFakeTimers();
    const pending = createAlertMailer({
      env: () => env,
      sendEmail: () => new Promise(() => {}),
      timeoutMs: 10,
    })(event, 'id-1');
    await vi.advanceTimersByTimeAsync(11);
    expect(await pending).toEqual({ kind: 'uncertain', code: 'delivery_unconfirmed' });
  });
  it('passes stable delivery reference and bounded no-retry options to Gmail', async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const result = await createAlertMailer({
      env: () => ({
        ...env,
        OPERATIONAL_TELEMETRY_ALERT_SENDER: 'daniel@example.com',
        OPERATIONAL_TELEMETRY_GMAIL_REFRESH_TOKEN: 'dedicated-secret',
        OPERATIONAL_TELEMETRY_ALERT_SENDER_NAME: 'Daniel Opazo · HHR',
      }),
    })(event, 'abc-123');
    expect(result.kind).toBe('sent');
    const [request, options] = mocks.send.mock.calls[0];
    expect(options).toEqual({ timeout: 8000, retry: false });
    const mime = Buffer.from(request.requestBody.raw, 'base64url').toString();
    expect(mime).toContain('Message-ID: <hhr-alert-abc-123@hospitalhangaroa.cl>');
    expect(mime).toContain(
      `From: =?UTF-8?B?${Buffer.from('Daniel Opazo · HHR').toString('base64')}?= <daniel@example.com>`
    );
    expect(mime).not.toContain('dedicated-secret');
  });
  it('rejects header injection and leaves ordinary census calls without new request options', async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    await expect(
      sendCensusEmail({
        date: '2026-09-11',
        recipients: ['a@example.com'],
        sender: { name: 'HHR\r\nBcc: other@example.com', email: 'a@example.com' },
      })
    ).rejects.toThrow('Remitente');
    await sendCensusEmail({ date: '2026-09-11', recipients: ['a@example.com'] });
    expect(mocks.send.mock.calls[0][1]).toBeUndefined();
  });
});
