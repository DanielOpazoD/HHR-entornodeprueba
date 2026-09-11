import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OPERATIONAL_TELEMETRY_ALERT_THROTTLE_MS,
  createOperationalTelemetryHandler,
} from '../../../netlify/functions/operational-telemetry';
import {
  parseOperationalTelemetryBody,
  sanitizeOperationalTelemetryContext,
} from '../../../src/services/observability/operationalTelemetryIngestPolicy';

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
    expect(context).toEqual({ runId: 'run-1', count: 3, ok: true });
    expect(dropped.sort()).toEqual(['bedId', 'encounterId', 'nested', 'patientName', 'rut']);
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

  const handler = createOperationalTelemetryHandler({
    sendEmail,
    gmailConfigured: () => true,
    now: () => now,
    log,
    env: () => env as NodeJS.ProcessEnv,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, URL: ORIGIN };
    for (const key of Object.keys(env)) delete env[key];
    env.URL = ORIGIN;
    env.OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS = 'guardia@hospital.cl, jefe@hospital.cl';
    sendEmail.mockResolvedValue({ id: 'msg' });
    // The throttle lives in the handler instance; start every test outside the previous window.
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
    expect(JSON.parse(response.body)).toEqual({ accepted: true, alert: 'sent' });

    expect(sendEmail).toHaveBeenCalledOnce();
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.recipients).toEqual(['guardia@hospital.cl', 'jefe@hospital.cl']);
    expect(mail.subject).toBe('[HHR] FALLO · rayen_sync_run · 2026-09-10');
    expect(mail.body).toContain('Structural persist timeout');
    expect(mail.body).toContain('runId: run-1');
    expect(mail.body).not.toContain('Juan');

    const line = JSON.parse(log.mock.calls[0][0]);
    expect(line.kind).toBe('event');
    expect(line.event.context).toEqual({ runId: 'run-1' });
    expect(line.event.droppedContextKeys).toEqual(['patientName']);
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
      request(envelope(failedRun({ operation: 'backup_export' })))
    );
    expect(noRecipients.statusCode).toBe(202);
    expect(JSON.parse(noRecipients.body).alert).toBe('no_recipients');

    env.OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS = 'guardia@hospital.cl';
    sendEmail.mockRejectedValueOnce(new Error('gmail down'));
    const failed = await handler(request(envelope(failedRun({ operation: 'create_day' }))));
    expect(failed.statusCode).toBe(202);
    expect(JSON.parse(failed.body).alert).toBe('send_failed');
    expect(log.mock.calls.some(call => JSON.parse(call[0]).kind === 'alert_error')).toBe(true);
  });
});
