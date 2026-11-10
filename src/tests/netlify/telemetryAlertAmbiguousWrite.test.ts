// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createAlertQueue,
  ALERT_QUEUE_POLICY as policy,
} from '../../../netlify/functions/lib/telemetry-alerts/queue';
import type {
  AlertEvent,
  AlertLedger,
  AlertLedgerStore,
  AlertSendResult,
} from '../../../netlify/functions/lib/telemetry-alerts/queue';

const event: AlertEvent = {
  category: 'integration',
  status: 'failed',
  operation: 'save_daily_record',
  timestamp: '2026-09-09T00:00:00Z',
  issues: [],
  context: {},
  droppedContextKeys: [],
};
const accepted: AlertSendResult = { kind: 'sent', code: 'accepted' };
const operations = [
  'enqueue',
  'claim',
  'sent',
  'failed',
  'retry',
  'uncertain',
  'scan',
  'maintenance',
  'expired-claim',
  'prune',
  'budget',
  'exhausted',
] as const;
type Operation = (typeof operations)[number];

const fixture = () => {
  let ledger: AlertLedger | null = null;
  let revision = 0;
  let sequence = 0;
  let time = 1_000_000;
  let target: Operation | undefined;
  let remaining = 0;
  let last = false;
  const send = vi.fn(async (): Promise<AlertSendResult> => accepted);
  const store: AlertLedgerStore = {
    async read() {
      return ledger ? { ledger: structuredClone(ledger), etag: String(revision) } : null;
    },
    async compareAndSet(next, etag) {
      if (etag !== (ledger ? String(revision) : null)) return false;
      const job = next.jobs[0];
      const matches =
        target === 'enqueue' ||
        target === 'scan' ||
        target === 'maintenance' ||
        target === 'prune' ||
        target === 'budget' ||
        target === 'exhausted' ||
        (target === 'claim' && job?.state === 'sending') ||
        (target === 'expired-claim' && job?.code === 'lease_expired') ||
        (target === 'sent' && job?.state === 'sent') ||
        (target === 'failed' && job?.code === 'provider_rejected') ||
        (target === 'uncertain' && job?.code === 'delivery_unconfirmed') ||
        (target === 'retry' && job?.state === 'pending' && job.attempts === 1);
      if (matches && remaining > 0) {
        remaining--;
        if (!last || remaining === 0) {
          ledger = structuredClone(next);
          revision++;
        }
        return false;
      }
      ledger = structuredClone(next);
      revision++;
      return true;
    },
  };
  const queue = () =>
    createAlertQueue({
      store,
      send,
      now: () => time,
      id: () => `test-${++sequence}`,
      delay: async () => {},
    });
  return {
    queue,
    store,
    send,
    ledger: () => ledger!,
    advance: (ms: number) => {
      time += ms;
    },
    arm: (operation: Operation, scenario: string) => {
      target = operation;
      last = scenario === 'last';
      remaining = last ? policy.casAttempts : 1;
    },
  };
};

for (const operation of operations) {
  describe(operation, () => {
    it.each(['first', 'last', 'concurrent'])(
      'preserves acknowledged outcome after %s ambiguous write',
      async scenario => {
        const run = async (ambiguous: boolean) => {
          const f = fixture();
          let id: string | undefined;
          if (operation !== 'enqueue') id = (await f.queue().enqueue(event)).id;
          if (operation === 'failed')
            f.send.mockResolvedValueOnce({ kind: 'permanent', code: 'provider_rejected' });
          if (operation === 'uncertain')
            f.send.mockResolvedValueOnce({ kind: 'uncertain', code: 'delivery_unconfirmed' });
          if (operation === 'retry')
            f.send.mockResolvedValueOnce({ kind: 'retryable', code: 'provider_rate_limited' });
          if (operation === 'maintenance') f.advance(policy.pendingTtlMs);
          if (operation === 'prune') {
            await f.queue().deliver(id!);
            f.advance(policy.receiptTtlMs);
          }
          if (operation === 'budget') {
            f.ledger().sendTimestamps = [1];
          }
          if (operation === 'exhausted') f.ledger().jobs[0].attempts = policy.maxAttempts;
          if (operation === 'expired-claim')
            f.send.mockImplementationOnce(async () => {
              f.advance(policy.leaseMs);
              return accepted;
            });
          if (ambiguous) f.arm(operation, scenario);
          const action = async () => {
            if (operation === 'enqueue') return f.queue().enqueue(event);
            if (['scan', 'maintenance', 'prune', 'budget', 'exhausted'].includes(operation))
              return f.queue().drain();
            return f.queue().deliver(id!);
          };
          const results =
            scenario === 'concurrent' ? await Promise.all([action(), action()]) : [await action()];
          if (operation === 'enqueue') await f.queue().deliver(f.ledger().jobs[0].id);
          if (operation === 'retry') {
            f.advance(60_000);
            await f.queue().drain();
          }
          await f.queue().drain();
          return {
            ledger: f.ledger(),
            sends: f.send.mock.calls.length,
            results: scenario === 'concurrent' ? undefined : results,
          };
        };
        expect(await run(true)).toEqual(await run(false));
      }
    );
  });
}

it('recognizes its claim after another producer changes the ledger before readback', async () => {
  const f = fixture();
  const { id } = await f.queue().enqueue(event);
  const cas = f.store.compareAndSet.bind(f.store);
  let interleave = true;
  vi.spyOn(f.store, 'compareAndSet').mockImplementation(async (ledger, etag) => {
    const ack = await cas(ledger, etag);
    if (ack && interleave && ledger.jobs[0].state === 'sending') {
      interleave = false;
      await f.queue().enqueue({ ...event, operation: 'another_operation' });
      return false;
    }
    return ack;
  });
  expect((await f.queue().deliver(id!)).alert).toBe('sent');
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.ledger().jobs[0]).toMatchObject({ state: 'sent', attempts: 1 });
  expect(f.ledger().jobs).toHaveLength(2);
});

it('confirms the JSON representation on the last attempt, including omitted optional fields', async () => {
  const f = fixture();
  const read = f.store.read.bind(f.store);
  vi.spyOn(f.store, 'read').mockImplementation(async () =>
    JSON.parse(JSON.stringify(await read()))
  );
  f.arm('enqueue', 'last');
  const { id } = await f.queue().enqueue({ ...event, date: undefined });
  expect((await f.queue().deliver(id!)).alert).toBe('sent');
  expect(f.send).toHaveBeenCalledTimes(1);
});
