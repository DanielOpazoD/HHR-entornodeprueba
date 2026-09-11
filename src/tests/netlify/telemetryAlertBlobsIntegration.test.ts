// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore } from '@netlify/blobs';
import {
  createAlertQueue,
  ALERT_QUEUE_POLICY,
} from '../../../netlify/functions/lib/telemetry-alerts/queue';
import {
  createAlertBlobFetch,
  createBlobAlertLedgerStore,
} from '../../../netlify/functions/lib/telemetry-alerts/store';
import { createAlertMailer } from '../../../netlify/functions/lib/telemetry-alerts/mail';
import { parseOperationalTelemetryBody } from '../../services/observability/operationalTelemetryIngestPolicy';
import {
  BlobCasHttpServer,
  BLOB_PATH,
  LOCAL_BLOBS_TOKEN,
  PRIVATE_PROVIDER_ERROR,
} from './support/blobCasHttpServer';

const ENV = {
  GMAIL_CLIENT_ID: 'synthetic-client-id',
  GMAIL_CLIENT_SECRET: 'synthetic-client-secret',
  GMAIL_REFRESH_TOKEN: 'synthetic-refresh-token',
  OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS: 'alerts@example.invalid',
};
const sanitizedEvent = () => {
  const result = parseOperationalTelemetryBody(
    JSON.stringify({
      source: 'hhr_operational_telemetry',
      event: {
        category: 'integration',
        status: 'failed',
        operation: 'rayen_sync_run',
        timestamp: '2026-09-09T00:00:00Z',
        issues: [],
        context: { token: 'synthetic-input-token', patientName: 'synthetic-person' },
      },
    })
  );
  if (!result.ok) throw new Error('fixture_event_rejected');
  return result.event;
};

/** Real SDK, real HTTP, real filesystem; only the remote services are controlled fixtures. */
describe('telemetry alerts through Blobs SDK and HTTP provider', () => {
  let server: BlobCasHttpServer;
  let time: number;
  beforeEach(async () => {
    server = await BlobCasHttpServer.create();
    time = 1_000_000;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await server?.dispose();
  });
  const sdk = (token = LOCAL_BLOBS_TOKEN, deadlineAt = Infinity, fetcher: typeof fetch = fetch) =>
    getStore({
      name: 'integration',
      siteID: 'test-site',
      token,
      edgeURL: server.url,
      uncachedEdgeURL: server.url,
      consistency: 'strong',
      fetch: createAlertBlobFetch(fetcher, deadlineAt),
    });
  const mailer = (timeoutMs = 2_000) =>
    createAlertMailer({
      env: () => ENV,
      timeoutMs,
      sendEmail: async params => {
        const response = await fetch(`${server.url}/gmail`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            subject: params.subject,
            body: params.body,
            messageId: params.deliveryOptions?.messageId,
          }),
          signal: AbortSignal.timeout(params.deliveryOptions!.timeoutMs),
        });
        if (!response.ok) {
          throw Object.assign(new Error(await response.text()), {
            response: { status: response.status },
          });
        }
        return response.json();
      },
    });
  const queue = (send = mailer(), blobs = sdk()) =>
    createAlertQueue({
      store: createBlobAlertLedgerStore(blobs),
      send,
      now: () => time,
    });
  const job = async () => (await server.receipt())!.ledger.jobs[0];
  const assertSafeReceipt = async () => {
    const raw = await server.rawReceipt();
    for (const secret of [
      LOCAL_BLOBS_TOKEN,
      ENV.GMAIL_CLIENT_ID,
      ENV.GMAIL_CLIENT_SECRET,
      ENV.GMAIL_REFRESH_TOKEN,
      ENV.OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS,
      PRIVATE_PROVIDER_ERROR,
      'synthetic-input-token',
      'synthetic-person',
    ])
      expect(raw).not.toContain(secret);
  };

  it('enforces real SDK ETags and atomic conditional writes, including auth and missing blobs', async () => {
    const a = createBlobAlertLedgerStore(sdk());
    const b = createBlobAlertLedgerStore(sdk());
    expect(await a.read()).toBeNull();
    const empty = { version: 1 as const, jobs: [], sendTimestamps: [] };
    expect(
      (await Promise.all([a.compareAndSet(empty, null), b.compareAndSet(empty, null)])).sort()
    ).toEqual([false, true]);
    const first = (await a.read())!;
    expect(first.etag).toBe('"revision-1"');
    const writes = await Promise.all([
      a.compareAndSet({ ...empty, sendTimestamps: [time] }, first.etag),
      b.compareAndSet({ ...empty, sendTimestamps: [time + 1] }, first.etag),
    ]);
    expect(writes.sort()).toEqual([false, true]);
    expect((await b.read())!.etag).toBe('"revision-2"');
    expect((await server.receipt())!.version).toBe(2);
    expect(server.requests.filter(request => request.status === 412)).toHaveLength(2);
    await expect(createBlobAlertLedgerStore(sdk('incorrect-local-token')).read()).rejects.toThrow();
    expect((await server.receipt())!.version).toBe(2);
  });

  it.each([401, 404, 409, 500])(
    'rejects HTTP PUT %i without sending or mutating the pending receipt',
    async status => {
      const { id } = await queue().enqueue(sanitizedEvent());
      const pending = await server.rawReceipt();
      const before = server.requests.length;
      server.failPut = status;
      await expect(queue().deliver(id!)).rejects.toThrow('alert_blob_transport_rejected');
      expect(server.gmailRequests).toHaveLength(0);
      expect(await server.rawReceipt()).toBe(pending);
      expect(await job()).toMatchObject({ id, state: 'pending', attempts: 0 });
      const rejected = server.requests.slice(before).filter(request => request.method === 'PUT');
      expect(rejected.length).toBeGreaterThan(0);
      expect(
        rejected.every(request => request.status === status && request.condition === '"revision-1"')
      ).toBe(true);
      expect((await server.receipt())!.ledger.sendTimestamps).toHaveLength(0);
      await assertSafeReceipt();
      server.failPut = undefined;
      expect((await queue().deliver(id!)).alert).toBe('sent');
      expect(server.gmailRequests).toHaveLength(1);
    }
  );

  it.each([0, 49])('fails closed before HTTP when only %i milliseconds remain', async remaining => {
    const { id } = await queue().enqueue(sanitizedEvent());
    const pending = await server.rawReceipt();
    const before = server.requests.length;
    vi.spyOn(Date, 'now').mockReturnValue(time);
    const expired = queue(mailer(), sdk(LOCAL_BLOBS_TOKEN, time + remaining));
    await expect(expired.deliver(id!)).rejects.toThrow('alert_execution_deadline');
    expect(server.requests).toHaveLength(before);
    expect(server.gmailRequests).toHaveLength(0);
    expect(await server.rawReceipt()).toBe(pending);
  });

  it('does not issue a claim PUT if the execution deadline expires after its ledger GET', async () => {
    const { id } = await queue().enqueue(sanitizedEvent());
    const pending = await server.rawReceipt();
    const before = server.requests.length;
    const deadline = time + 28_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(time);
    const delayedRead: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if ((init?.method ?? 'GET').toUpperCase() === 'GET') clock.mockReturnValue(deadline - 49);
      return response;
    };
    const exhausted = queue(mailer(), sdk(LOCAL_BLOBS_TOKEN, deadline, delayedRead));
    await expect(exhausted.deliver(id!)).rejects.toThrow('alert_execution_deadline');
    expect(server.requests.slice(before).map(request => request.method)).toEqual(['GET']);
    expect(server.gmailRequests).toHaveLength(0);
    expect(await server.rawReceipt()).toBe(pending);
  });

  it('shares one SDK across independent producers/workers and emits exactly one HTTP mail', async () => {
    const shared = sdk();
    const a = queue(mailer(), shared);
    const b = queue(mailer(), shared);
    const [first, second] = await Promise.all([
      a.enqueue(sanitizedEvent()),
      b.enqueue(sanitizedEvent()),
    ]);
    expect(first.id).toBe(second.id);
    await Promise.all([a.deliver(first.id!), b.deliver(second.id!)]);
    expect(server.gmailRequests).toHaveLength(1);
    expect(server.gmailRequests[0].messageId).toBe(`<hhr-alert-${first.id}@hospitalhangaroa.cl>`);
    expect(await job()).toMatchObject({
      id: first.id,
      state: 'sent',
      attempts: 1,
      code: 'accepted',
    });
    expect((await server.receipt())!.ledger.sendTimestamps).toHaveLength(1);
    expect(server.requests.every(request => request.path === BLOB_PATH)).toBe(true);
    expect(server.requests.some(request => request.status === 412)).toBe(true);
    await assertSafeReceipt();
  });

  it('survives server restart and fresh SDK/queue: explicit HTTP 429 then one successful retry', async () => {
    server.gmailReplies = [429, 200];
    const initial = queue();
    const { id } = await initial.enqueue(sanitizedEvent());
    expect(await initial.deliver(id!)).toEqual({ alert: 'retry_scheduled', id });
    const pending = await job();
    expect(pending).toMatchObject({ state: 'pending', attempts: 1, code: 'provider_rate_limited' });
    expect(pending.nextDueAt).toBe(time + 60_000);
    await assertSafeReceipt();
    await server.stop();
    await server.start(); // New listener, same disk; no in-memory ledger exists in the fixture.
    const fresh = queue();
    expect(await job()).toEqual(pending);
    expect(await fresh.enqueue(sanitizedEvent())).toEqual({ alert: 'queued', id });
    expect(await job()).toEqual(pending);
    expect((await fresh.deliver(id!)).alert).toBe('throttled');
    expect(server.gmailRequests).toHaveLength(1);
    time += 60_000;
    expect((await fresh.drain()).sent).toBe(1);
    expect(await job()).toMatchObject({ id, state: 'sent', attempts: 2, code: 'accepted' });
    await queue().drain();
    expect(server.gmailRequests).toHaveLength(2);
    expect(server.gmailRequests[0].messageId).toBe(server.gmailRequests[1].messageId);
    await assertSafeReceipt();
  });

  it('treats an HTTP provider timeout as ambiguous and never automatically resends', async () => {
    server.gmailReplies = ['hang'];
    const { id } = await queue().enqueue(sanitizedEvent());
    expect((await queue(mailer(80)).deliver(id!)).alert).toBe('uncertain');
    expect(server.gmailRequests).toHaveLength(1);
    expect(await job()).toMatchObject({
      state: 'uncertain',
      code: 'delivery_unconfirmed',
      attempts: 1,
    });
    await server.stop();
    await server.start();
    time += ALERT_QUEUE_POLICY.leaseMs + 300_000;
    expect((await queue().drain()).processed).toBe(0);
    expect((await queue().deliver(id!)).alert).toBe('uncertain');
    expect(server.gmailRequests).toHaveLength(1);
    await assertSafeReceipt();
  });

  it('keeps the durable claim when final receipt writes fail, then marks it uncertain after restart', async () => {
    const { id } = await queue().enqueue(sanitizedEvent());
    server.blockTerminalWrites = true;
    await expect(queue().deliver(id!)).rejects.toThrow();
    expect(server.gmailRequests).toHaveLength(1);
    expect(server.blockedWrites).toBeGreaterThan(0); // Includes the SDK's own transport retries.
    expect(await job()).toMatchObject({ id, state: 'sending', attempts: 1 });
    expect((await job()).leaseToken).toBeTruthy();
    await server.stop();
    server.blockTerminalWrites = false;
    await server.start();
    time += ALERT_QUEUE_POLICY.leaseMs;
    expect((await queue().drain()).processed).toBe(0);
    expect(await job()).toMatchObject({
      id,
      state: 'uncertain',
      code: 'lease_expired',
      attempts: 1,
    });
    expect((await queue().deliver(id!)).alert).toBe('uncertain');
    expect(server.gmailRequests).toHaveLength(1);
    await assertSafeReceipt();
  });
});
