// @vitest-environment node
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import retry, { config } from '../../../netlify/functions/operational-telemetry-retry';
import { createRuntimeAlertQueue } from '../../../netlify/functions/lib/telemetry-alerts/runtime';
import { getRuntimeAlertLedgerStore } from '../../../netlify/functions/lib/telemetry-alerts/store';
import { sendCensusEmail } from '../../../src/services/email/gmailClient';
import { createAlertTestStore } from './support/alertTestStore';

// Keep the entrypoint, runtime, queue and mail classifier real; replace only external I/O.
vi.mock('../../../netlify/functions/lib/telemetry-alerts/store', () => ({
  getRuntimeAlertLedgerStore: vi.fn(),
}));
vi.mock('../../../src/services/email/gmailClient', () => ({
  sendCensusEmail: vi.fn(),
  DEFAULT_GMAIL_SENDER: { name: 'Synthetic guard', email: 'sender@example.invalid' },
}));

const context = {
  deploy: { context: 'production', id: 'synthetic-deploy', published: true },
  site: { url: 'https://synthetic.example.invalid' },
};
const secrets = ['synthetic-client', 'synthetic-secret', 'synthetic-refresh'];
const rawError = `provider raw exception: ${secrets.join('/')}`;
const request = (method = 'POST') =>
  new Request(`${context.site.url}/.netlify/functions/operational-telemetry-retry`, { method });
const event = {
  category: 'integration' as const,
  status: 'failed' as const,
  operation: 'rayen_sync_run',
  timestamp: '2026-11-12T12:00:00.000Z',
  date: '2026-11-12',
  issues: ['synthetic_failure'],
  context: {},
  droppedContextKeys: [],
};
const emptyCounts = {
  processed: 0,
  sent: 0,
  retry_scheduled: 0,
  failed: 0,
  uncertain: 0,
  throttled: 0,
};

let store = createAlertTestStore();
let logs: ReturnType<typeof vi.spyOn>[];
const seed = (operation = event.operation) =>
  createRuntimeAlertQueue(context).enqueue({ ...event, operation });
const jobs = async () => (await store.read())?.ledger.jobs;
const sweep = async () => {
  const response = await retry(request(), context);
  expect(response).toBeUndefined(); // Scheduled functions have no HTTP response body.
};
const expectSweep = (counts: Partial<typeof emptyCounts>) => {
  expect(logs[0]).toHaveBeenLastCalledWith(
    JSON.stringify({
      source: 'operational-telemetry',
      kind: 'retry_sweep',
      ...emptyCounts,
      ...counts,
    })
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(event.timestamp));
  // Entire environment is synthetic, including the production branch selector above.
  vi.stubGlobal('process', {
    ...process,
    env: {
      GMAIL_CLIENT_ID: secrets[0],
      GMAIL_CLIENT_SECRET: secrets[1],
      GMAIL_REFRESH_TOKEN: secrets[2],
      OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS: 'guard@example.invalid',
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected real network access');
    })
  );
  store = createAlertTestStore();
  vi.mocked(getRuntimeAlertLedgerStore).mockReturnValue(store);
  vi.mocked(sendCensusEmail).mockResolvedValue({ id: 'synthetic-message' });
  logs = ['info', 'warn', 'error', 'log', 'debug'].map(method =>
    vi.spyOn(console, method as 'info').mockImplementation(() => {})
  );
});
afterEach(() => {
  const output = inspect(
    logs.map(log => log.mock.calls),
    { depth: null }
  );
  for (const secret of [...secrets, rawError]) expect(output).not.toContain(secret);
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('operational telemetry scheduled retry', () => {
  it('retains the private scheduled entrypoint declaration', () => {
    expect(config).toEqual({ schedule: '*/5 * * * *' });
  });

  it('sends one pending alert per invocation, persists receipts and never resends them', async () => {
    const first = await seed();
    const second = await seed('send_census_email');
    await sweep();
    expect(sendCensusEmail).toHaveBeenCalledTimes(1);
    expectSweep({ processed: 1, sent: 1 });
    expect((await jobs())?.filter(job => job.state === 'sent')).toHaveLength(1);
    expect((await jobs())?.filter(job => job.state === 'pending')).toHaveLength(1);
    await sweep();
    const receipts = await jobs();
    expect(receipts).toHaveLength(2);
    for (const id of [first.id, second.id]) {
      expect(receipts).toContainEqual(
        expect.objectContaining({
          id,
          state: 'sent',
          attempts: 1,
          code: 'accepted',
          sentAt: Date.now(),
        })
      );
    }
    await sweep();
    expect(sendCensusEmail).toHaveBeenCalledTimes(2);
    expect(await jobs()).toEqual(receipts);
    expectSweep({});
  });

  it('does not send mail when the store is empty', async () => {
    await sweep();
    expect(sendCensusEmail).not.toHaveBeenCalled();
    expect(await jobs()).toEqual([]);
    expectSweep({});
  });

  it('retains a rejected delivery for its due retry, then records one successful delivery', async () => {
    const queued = await seed();
    vi.mocked(sendCensusEmail).mockRejectedValueOnce(
      Object.assign(new Error(rawError), { response: { status: 429 } })
    );
    await sweep();
    expectSweep({ processed: 1, retry_scheduled: 1 });
    const pending = (await jobs())![0];
    expect(pending).toMatchObject({
      id: queued.id,
      event,
      state: 'pending',
      attempts: 1,
      code: 'provider_rate_limited',
    });
    expect(pending.nextDueAt).toBeGreaterThan(Date.now());
    await sweep();
    expect(sendCensusEmail).toHaveBeenCalledTimes(1);
    vi.setSystemTime(pending.nextDueAt);
    await sweep();
    expect(await jobs()).toEqual([
      expect.objectContaining({ id: queued.id, state: 'sent', attempts: 2 }),
    ]);
    await sweep();
    expect(sendCensusEmail).toHaveBeenCalledTimes(2);
    const messageIds = vi
      .mocked(sendCensusEmail)
      .mock.calls.map(([mail]) => mail.deliveryOptions?.messageId);
    expect(messageIds).toEqual([
      `<hhr-alert-${queued.id}@hospitalhangaroa.cl>`,
      `<hhr-alert-${queued.id}@hospitalhangaroa.cl>`,
    ]);
  });

  it('retains an uncertain provider outcome without automatically duplicating the mail', async () => {
    const queued = await seed();
    vi.mocked(sendCensusEmail).mockRejectedValueOnce(new Error(rawError));
    await sweep();
    expectSweep({ processed: 1, uncertain: 1 });
    expect(await jobs()).toEqual([
      expect.objectContaining({
        id: queued.id,
        event,
        state: 'uncertain',
        attempts: 1,
        code: 'delivery_unconfirmed',
      }),
    ]);
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await sweep();
    expect(sendCensusEmail).toHaveBeenCalledTimes(1);
  });

  it.each(['initialization', 'read'] as const)(
    'sanitizes %s failures and preserves pending alerts for recovery',
    async failure => {
      const queued = await seed();
      if (failure === 'initialization')
        vi.mocked(getRuntimeAlertLedgerStore).mockImplementationOnce(() => {
          throw new Error(rawError);
        });
      else vi.spyOn(store, 'read').mockRejectedValueOnce(new Error(rawError));
      await expect(retry(request(), context)).rejects.toThrow(/^alert_retry_unavailable$/);
      expect(logs[0]).toHaveBeenLastCalledWith(
        JSON.stringify({
          source: 'operational-telemetry',
          kind: 'retry_unavailable',
          code: 'alert_store_unavailable',
        })
      );
      expect(sendCensusEmail).not.toHaveBeenCalled();
      expect(await jobs()).toEqual([
        expect.objectContaining({ id: queued.id, state: 'pending', attempts: 0 }),
      ]);
      await sweep();
      expect(sendCensusEmail).toHaveBeenCalledOnce();
    }
  );

  // Known boundary: Netlify enforces private scheduling before calling this function.
  // Direct calls have no HTTP auth/method guard. These are NOT proof of public exposure.
  it.fails.each(['POST', 'GET'])(
    'rejects a direct unauthenticated %s invocation (platform boundary not available locally)',
    async method => {
      await seed();
      await retry(request(method), context);
      expect(sendCensusEmail).not.toHaveBeenCalled();
    }
  );
});
