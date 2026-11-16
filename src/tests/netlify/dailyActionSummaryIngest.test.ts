// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOperationalTelemetryHandler } from '../../../netlify/functions/operational-telemetry';
import type { AlertQueue } from '../../../netlify/functions/lib/telemetry-alerts/queueTypes';
import { DAILY_ACTION_OPERATIONS } from '../../../src/services/observability/dailyActionSummaryContract';

/** A hand-made request: the endpoint is public, so nothing here relies on the browser producer. */
const crafted = (operation: string, status: string) =>
  JSON.stringify({
    source: 'hhr_operational_telemetry',
    event: {
      category: 'daily_record',
      status,
      operation,
      timestamp: '2026-11-15T12:00:00.000Z',
      date: '2026-11-14',
      issues: ['persistence_issue'],
      context: {
        count: 4,
        degradedCount: 1,
        p50Ms: 120,
        p90Ms: 900,
        maxMs: 1_500,
        durationMs: 125,
        retryCount: 2,
        reason: 'manual',
        patientName: 'Paciente Sintético',
        bedId: 'R1',
        rut: '12.345.678-5',
      },
    },
  });

const setup = () => {
  const lines: string[] = [];
  const queue = vi.fn((): AlertQueue => {
    throw new Error('a timing summary must never reach the alert queue');
  });
  let ip = 0;
  const handler = createOperationalTelemetryHandler({
    queue,
    now: () => Date.parse('2026-11-15T12:00:01.000Z'),
    log: line => lines.push(line),
  });
  const post = (body: string) =>
    handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://testinghhr.netlify.app',
        'x-nf-client-connection-ip': `198.51.100.${(ip += 1)}`,
      },
      body,
    });
  return { lines, queue, post };
};

describe('daily action summaries at the endpoint', () => {
  beforeEach(() => vi.stubEnv('URL', 'https://testinghhr.netlify.app'));
  afterEach(() => vi.unstubAllEnvs());

  it.each(DAILY_ACTION_OPERATIONS)('%s keeps only the closed numbers, never the date', async op => {
    const { lines, post } = setup();
    expect((await post(crafted(op, 'success'))).statusCode).toBe(202);
    const { event } = JSON.parse(lines[0]) as { event: Record<string, unknown> };
    expect(event).toEqual({
      category: 'daily_record',
      status: 'success',
      operation: op,
      timestamp: '2026-11-15T12:00:00.000Z',
      issues: [],
      context: { count: 4, degradedCount: 1, p50Ms: 120, p90Ms: 900, maxMs: 1_500 },
      droppedContextKeys: Array.from({ length: 6 }, () => 'dropped'),
    });
    expect(lines[0]).not.toMatch(/2026-11-14|Sint|R1|12\.345/);
  });

  it.each(DAILY_ACTION_OPERATIONS)('%s sent as failed is logged and never queued', async op => {
    const { lines, queue, post } = setup();
    const response = await post(crafted(op, 'failed'));
    expect(response.statusCode).toBe(202);
    expect(queue).not.toHaveBeenCalled();
    expect(JSON.parse(lines[0])).toMatchObject({ alert: 'not_alertable' });
  });
});
