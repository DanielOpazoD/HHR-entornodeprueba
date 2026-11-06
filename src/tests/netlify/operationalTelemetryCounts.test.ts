import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOperationalTelemetryHandler } from '../../../netlify/functions/operational-telemetry';
import { getStore } from '@netlify/blobs';
import {
  COUNT_BUDGET_MS,
  addTelemetryCount,
  createCountBlobFetch,
  countsStoreName,
  createDailyTelemetryCounter,
  type DailyTelemetryCounts,
} from '../../../netlify/functions/lib/telemetry-counts';
import type { AlertQueue } from '../../../netlify/functions/lib/telemetry-alerts/queueTypes';

const ORIGIN = 'https://testinghhr.netlify.app';
// 23:30 on 8 November in Rapa Nui: the day is the hospital's, not UTC's.
const NOW = Date.parse('2026-11-09T04:30:00.000Z');

type CounterStore = Parameters<typeof createDailyTelemetryCounter>[0];

/** Memory blob store with etags, like Netlify Blobs' conditional writes. */
const createEtagStore = () => {
  const data = new Map<string, { value: unknown; etag: string }>();
  let version = 0;
  return {
    data,
    async getWithMetadata(key: string) {
      const entry = data.get(key);
      return entry ? { data: structuredClone(entry.value), etag: entry.etag, metadata: {} } : null;
    },
    async setJSON(
      key: string,
      value: unknown,
      options: { onlyIfMatch?: string; onlyIfNew?: boolean }
    ) {
      const entry = data.get(key);
      if (options.onlyIfNew && entry) return { modified: false };
      if (options.onlyIfMatch !== undefined && entry?.etag !== options.onlyIfMatch) {
        return { modified: false };
      }
      data.set(key, { value: structuredClone(value), etag: `e${++version}` });
      return { modified: true, etag: `e${version}` };
    },
  };
};

const envelope = (event: Record<string, unknown>) =>
  JSON.stringify({ source: 'hhr_operational_telemetry', event });
const request = (event: Record<string, unknown>) => ({
  httpMethod: 'POST',
  headers: { origin: ORIGIN, 'x-nf-client-connection-ip': '10.0.0.9' },
  body: envelope(event),
});
const resumeFailure = {
  category: 'daily_record',
  status: 'degraded',
  operation: 'daily_record_resume_refresh_failed',
  timestamp: '2026-11-09T04:29:00.000Z',
  issues: ['Texto libre que nunca se cuenta'],
};
const silentQueue = (): AlertQueue => ({
  enqueue: vi.fn(),
  deliver: vi.fn(),
  drain: vi.fn(),
});

describe('daily operational telemetry counts', () => {
  it('counts by operation, status and alert outcome, and starts a new day from zero', () => {
    const entry = {
      operation: 'census_exists_timeout',
      status: 'degraded',
      alert: 'not_alertable',
      receivedAt: NOW,
    };
    const first = addTelemetryCount(null, '2026-11-08', entry);
    const second = addTelemetryCount(first, '2026-11-08', entry);
    expect(second).toEqual({
      date: '2026-11-08',
      operations: { census_exists_timeout: { degraded: 2 } },
      alerts: { not_alertable: 2 },
    });
    expect(addTelemetryCount(second, '2026-11-09', entry).operations).toEqual({
      census_exists_timeout: { degraded: 1 },
    });
  });

  it('stores only bounded codes: free text and unknown names become «other»', () => {
    const counts = addTelemetryCount(null, '2026-11-08', {
      operation: 'Juan Pérez 12.345.678-5',
      status: 'failed',
      alert: 'sent',
      receivedAt: NOW,
    });
    expect(counts.operations).toEqual({ other: { failed: 1 } });
    let full: DailyTelemetryCounts | null = null;
    for (let index = 0; index < 205; index++) {
      full = addTelemetryCount(full, '2026-11-08', {
        operation: `op_${index}`,
        status: 'success',
        alert: 'not_alertable',
        receivedAt: NOW,
      });
    }
    expect(Object.keys(full!.operations)).toHaveLength(201);
    expect(full!.operations.other).toEqual({ success: 5 });
  });

  it('keeps every count when two events race on the same day', async () => {
    const store = createEtagStore();
    const count = createDailyTelemetryCounter(store as unknown as CounterStore);
    const entry = {
      operation: 'app_shell_ready',
      status: 'success',
      alert: 'not_alertable',
      receivedAt: NOW,
    };
    const results = await Promise.all([count(entry), count(entry), count(entry)]);
    expect(results).toEqual(['counted', 'counted', 'counted']);
    expect(store.data.get('daily/2026-11-08')?.value).toEqual({
      date: '2026-11-08',
      operations: { app_shell_ready: { success: 3 } },
      alerts: { not_alertable: 3 },
    });
  });

  it('reports a lost race instead of overwriting the day', async () => {
    const store = createEtagStore();
    const losing = { ...store, setJSON: vi.fn(async () => ({ modified: false })) };
    const count = createDailyTelemetryCounter(losing as unknown as CounterStore);
    await expect(
      count({
        operation: 'app_shell_ready',
        status: 'success',
        alert: 'not_alertable',
        receivedAt: NOW,
      })
    ).resolves.toBe('count_conflict');
    expect(losing.setJSON).toHaveBeenCalledTimes(4);
  });

  it('never lets the Blobs SDK retry: a failing store costs one request, not five sleeps', async () => {
    const real = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      (init?.method ?? 'GET').toUpperCase() === 'GET'
        ? new Response(null, { status: 404 })
        : new Response('down', { status: 503 })
    );
    const store = getStore({
      name: 'operational-counts-v1-preview-test',
      siteID: 'synthetic-site',
      token: 'synthetic-token',
      edgeURL: 'https://edge.invalid',
      uncachedEdgeURL: 'https://uncached-edge.invalid',
      fetch: createCountBlobFetch(real as unknown as typeof fetch),
    });
    const count = createDailyTelemetryCounter(store);
    await expect(
      count({
        operation: 'app_shell_ready',
        status: 'success',
        alert: 'not_alertable',
        receivedAt: NOW,
      })
    ).resolves.toBe('count_conflict');
    // Four compare-and-set rounds of one read and one write each, and nothing retried in between.
    expect(real).toHaveBeenCalledTimes(8);

    real.mockImplementation(async () => new Response('down', { status: 503 }));
    real.mockClear();
    await expect(
      count({
        operation: 'app_shell_ready',
        status: 'success',
        alert: 'not_alertable',
        receivedAt: NOW,
      })
    ).rejects.toThrow();
    expect(real).toHaveBeenCalledTimes(1);
  });

  it('never reports a rejected write as counted', async () => {
    for (const status of [400, 401, 403]) {
      const real = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        (init?.method ?? 'GET').toUpperCase() === 'GET'
          ? new Response(null, { status: 404 })
          : new Response('denied', { status })
      );
      const store = getStore({
        name: 'operational-counts-v1-preview-test',
        siteID: 'synthetic-site',
        token: 'synthetic-token',
        edgeURL: 'https://edge.invalid',
        uncachedEdgeURL: 'https://uncached-edge.invalid',
        fetch: createCountBlobFetch(real as unknown as typeof fetch),
      });
      await expect(
        createDailyTelemetryCounter(store)({
          operation: 'app_shell_ready',
          status: 'success',
          alert: 'not_alertable',
          receivedAt: NOW,
        })
      ).resolves.toBe('count_conflict');
    }
  });

  it('keeps production counts apart from previews', () => {
    const deploy = { context: 'production', id: 'abc123', published: true };
    expect(countsStoreName({ deploy, site: { url: ORIGIN } })).toBe(
      'operational-counts-v1-production'
    );
    expect(
      countsStoreName({ deploy: { ...deploy, context: 'deploy-preview' }, site: { url: ORIGIN } })
    ).toBe('operational-counts-v1-preview-abc123');
  });
});

describe('operational telemetry handler counting', () => {
  const originalUrl = process.env.URL;
  beforeEach(() => {
    process.env.URL = ORIGIN;
  });
  afterEach(() => {
    process.env.URL = originalUrl;
  });

  it('counts each accepted event with its alert outcome and logs the result', async () => {
    const count = vi.fn(async () => 'counted' as const);
    const log = vi.fn();
    const handler = createOperationalTelemetryHandler({
      queue: silentQueue,
      now: () => NOW,
      log,
      count,
    });
    const result = await handler(request(resumeFailure));
    expect(result.statusCode).toBe(202);
    expect(count).toHaveBeenCalledWith({
      operation: 'daily_record_resume_refresh_failed',
      status: 'degraded',
      alert: 'not_alertable',
      receivedAt: NOW,
    });
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ kind: 'event', count: 'counted' });
  });

  it('never lets a counting failure change the answer to the browser', async () => {
    const log = vi.fn();
    const handler = createOperationalTelemetryHandler({
      queue: silentQueue,
      now: () => NOW,
      log,
      count: async () => {
        throw new Error('blob store down');
      },
    });
    const result = await handler(request(resumeFailure));
    expect(result.statusCode).toBe(202);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ count: 'count_failed' });
    expect(log.mock.calls[0][0]).not.toContain('blob store down');
  });

  it('counts on the day the event arrived, even if alert delivery ends after midnight', async () => {
    // Arrives at 23:59:55 on the 8th in Rapa Nui; the clock reads 00:00:05 when counting starts.
    const arrival = Date.parse('2026-11-09T04:59:55.000Z');
    const clock = [arrival, arrival + 10_000];
    const store = createEtagStore();
    const handler = createOperationalTelemetryHandler({
      queue: silentQueue,
      now: () => clock.shift() ?? arrival + 10_000,
      log: vi.fn(),
      count: createDailyTelemetryCounter(store as unknown as CounterStore),
    });
    expect((await handler(request(resumeFailure))).statusCode).toBe(202);
    expect([...store.data.keys()]).toEqual(['daily/2026-11-08']);
  });

  it('answers within the counting budget when the store never answers', async () => {
    vi.useFakeTimers();
    try {
      const log = vi.fn();
      const handler = createOperationalTelemetryHandler({
        queue: silentQueue,
        now: () => NOW,
        log,
        count: () => new Promise(() => undefined),
      });
      const pending = handler(request(resumeFailure));
      await vi.advanceTimersByTimeAsync(COUNT_BUDGET_MS);
      expect((await pending).statusCode).toBe(202);
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ count: 'count_timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not count a rejected payload', async () => {
    const count = vi.fn();
    const handler = createOperationalTelemetryHandler({
      queue: silentQueue,
      now: () => NOW,
      log: vi.fn(),
      count,
    });
    const result = await handler({ ...request(resumeFailure), body: '{"source":"other"}' });
    expect(result.statusCode).toBe(400);
    expect(count).not.toHaveBeenCalled();
  });
});
