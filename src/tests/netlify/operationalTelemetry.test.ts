import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOperationalTelemetryHandler } from '../../../netlify/functions/operational-telemetry';
import {
  parseOperationalTelemetryBody,
  sanitizeOperationalTelemetryContext,
} from '../../../src/services/observability/operationalTelemetryIngestPolicy';

import {
  createAlertQueue,
  ALERT_QUEUE_POLICY,
} from '../../../netlify/functions/lib/telemetry-alerts/queue';
import {
  createAlertMailer,
  resolveAlertMailbox,
} from '../../../netlify/functions/lib/telemetry-alerts/mail';
import { createAlertTestStore } from './support/alertTestStore';
const OPERATIONAL_TELEMETRY_ALERT_THROTTLE_MS = ALERT_QUEUE_POLICY.cooldownMs;

const ORIGIN = 'https://testinghhr.netlify.app';

const envelope = (event: Record<string, unknown>) =>
  JSON.stringify({ source: 'hhr_operational_telemetry', event });

const failedRun = (overrides: Record<string, unknown> = {}) => ({
  category: 'integration',
  status: 'failed',
  operation: 'rayen_sync_run',
  timestamp: '2026-09-11T03:10:00.000Z',
  date: '2026-09-10',
  issues: ['Structural persist timeout: el guardado del censo superó los 90 s.'],
  context: { runId: 'run-1', stage: 'persisting_structure', durationMs: 91000 },
  ...overrides,
});

const request = (body: string | null, extra: Record<string, unknown> = {}) => ({
  httpMethod: 'POST',
  headers: { origin: ORIGIN, 'x-nf-client-connection-ip': '10.0.0.1' },
  body,
  ...extra,
});

describe('operational telemetry ingest policy', () => {
  it('drops any context key that could identify a patient and keeps only primitives', () => {
    const { context, dropped } = sanitizeOperationalTelemetryContext({
      runId: 'run-1',
      patientName: 'Juan',
      rut: '1-9',
      bedId: 'R1',
      encounterId: '142070',
      nested: { a: 1 },
      count: 3,
      ok: true,
    });
    expect(context).toEqual({ count: 3 });
    expect(dropped.length).toBeGreaterThan(0);
    expect(JSON.stringify(dropped)).not.toContain('patientName');
  });

  it('rejects oversized, malformed or foreign payloads', () => {
    expect(parseOperationalTelemetryBody('x'.repeat(9 * 1024))).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(parseOperationalTelemetryBody('{')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(
      parseOperationalTelemetryBody(JSON.stringify({ source: 'other', event: failedRun() }))
    ).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(parseOperationalTelemetryBody(envelope(failedRun({ status: 'boom' })))).toEqual({
      ok: false,
      reason: 'invalid_shape',
    });
  });
});

describe('operational-telemetry netlify function', () => {
  const originalEnv = { ...process.env };
  const sendEmail = vi.fn();
  const log = vi.fn();
  let now = Date.parse('2026-09-11T03:10:05.000Z');
  const env: Record<string, string | undefined> = {};

  let store = createAlertTestStore();
  const queue = () =>
    createAlertQueue({
      store,
      now: () => now,
      send: createAlertMailer({ env: () => env, sendEmail }),
    });
  const handler = createOperationalTelemetryHandler({ queue, now: () => now, log });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, URL: ORIGIN };
    for (const key of Object.keys(env)) delete env[key];
    store = createAlertTestStore();
    env.GMAIL_CLIENT_ID = 'test-client';
    env.GMAIL_CLIENT_SECRET = 'test-secret';
    env.GMAIL_REFRESH_TOKEN = 'test-refresh';
    env.URL = ORIGIN;
    env.OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS = 'guardia@hospital.cl, jefe@hospital.cl';
    sendEmail.mockResolvedValue({ id: 'msg' });
    // Each test starts with a clean durable-store substitute.
    now += OPERATIONAL_TELEMETRY_ALERT_THROTTLE_MS + 1;
  });

  it('refuses origins outside the site and non-POST methods', async () => {
    const foreign = await handler(
      request(envelope(failedRun()), { headers: { origin: 'https://evil.example' } })
    );
    expect(foreign.statusCode).toBe(403);
    const get = await handler(request(null, { httpMethod: 'GET' }));
    expect(get.statusCode).toBe(405);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('accepts a failed sync run, logs it sanitized and mails the guard without patient data', async () => {
    const response = await handler(
      request(envelope(failedRun({ context: { runId: 'run-1', patientName: 'Juan Pérez' } })))
    );
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({
      accepted: true,
      alert: 'sent',
      id: expect.any(String),
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.recipients).toEqual(['guardia@hospital.cl', 'jefe@hospital.cl']);
    expect(mail.subject).toBe('[HHR] FALLO · rayen_sync_run · 2026-09-10');
    expect(mail.body).not.toContain('Structural persist timeout');
    expect(mail.body).toContain('Referencia de entrega:');
    expect(mail.body).not.toContain('Juan');

    const line = JSON.parse(log.mock.calls[0][0]);
    expect(line.kind).toBe('event');
    expect(line.event.context).toEqual({});
    expect(line.event.droppedContextKeys.length).toBeGreaterThan(0);
    expect(JSON.stringify(line)).not.toContain('Juan');
  });

  it('only logs successes and throttles repeated alerts per operation', async () => {
    const ok = await handler(request(envelope(failedRun({ status: 'success', issues: [] }))));
    expect(JSON.parse(ok.body).alert).toBe('not_alertable');

    await handler(request(envelope(failedRun())));
    now += 60_000;
    const second = await handler(request(envelope(failedRun())));
    expect(JSON.parse(second.body).alert).toBe('throttled');
    now += OPERATIONAL_TELEMETRY_ALERT_THROTTLE_MS;
    const third = await handler(request(envelope(failedRun())));
    expect(JSON.parse(third.body).alert).toBe('sent');
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('still accepts the event when no recipients are configured or the mail fails', async () => {
    delete env.OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS;
    const noRecipients = await handler(
      request(envelope(failedRun({ operation: 'send_census_email' })))
    );
    expect(noRecipients.statusCode).toBe(202);
    expect(JSON.parse(noRecipients.body).alert).toBe('failed');

    env.OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS = 'guardia@hospital.cl';
    sendEmail.mockRejectedValueOnce(new Error('gmail down'));
    const failed = await handler(request(envelope(failedRun({ operation: 'import_json_backup' }))));
    expect(failed.statusCode).toBe(202);
    expect(JSON.parse(failed.body).alert).toBe('uncertain');
    expect(JSON.stringify(log.mock.calls)).not.toContain('gmail down');
  });

  it('uses the dedicated sender mailbox only when both its address and token are configured', async () => {
    env.OPERATIONAL_TELEMETRY_ALERT_SENDER = 'daniel.opazo@hospitalhangaroa.cl';
    expect(resolveAlertMailbox(env)).toBeNull();
    await handler(request(envelope(failedRun({ operation: 'send_census_email' }))));
    expect(sendEmail).not.toHaveBeenCalled();

    env.OPERATIONAL_TELEMETRY_GMAIL_REFRESH_TOKEN = 'token-of-daniel';
    env.OPERATIONAL_TELEMETRY_ALERT_SENDER_NAME = 'Daniel Opazo · HHR';
    await handler(request(envelope(failedRun({ operation: 'rayen_sync_run' }))));
    const mail = sendEmail.mock.calls.at(-1)?.[0];
    expect(mail.sender).toEqual({
      name: 'Daniel Opazo · HHR',
      email: 'daniel.opazo@hospitalhangaroa.cl',
    });
    expect(mail.refreshToken).toBe('token-of-daniel');
    expect(mail.body).not.toContain('token-of-daniel');
  });
  it('returns 503 instead of sending when durable storage is unavailable', async () => {
    const broken = createOperationalTelemetryHandler({
      now: () => now,
      log,
      queue: () => {
        throw new Error('secret-provider-payload');
      },
    });
    const response = await broken(request(envelope(failedRun())));
    expect(response.statusCode).toBe(503);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-provider-payload');
  });
});
