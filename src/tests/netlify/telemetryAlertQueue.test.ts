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

class CasStore implements AlertLedgerStore {
  ledger: AlertLedger | null = null;
  revision = 0;
  offline = false;
  reject = false;
  writes = 0;
  async read() {
    if (this.offline) throw new Error('storage_unavailable');
    return this.ledger
      ? { ledger: structuredClone(this.ledger), etag: String(this.revision) }
      : null;
  }
  async compareAndSet(ledger: AlertLedger, etag: string | null) {
    this.writes++;
    if (this.offline) throw new Error('storage_unavailable');
    if (this.reject || etag !== (this.ledger ? String(this.revision) : null)) return false;
    this.ledger = structuredClone(ledger);
    this.revision++;
    return true;
  }
}
const event = (operation = 'save_daily_record'): AlertEvent => ({
  category: 'daily_record',
  status: 'failed',
  operation,
  timestamp: '2026-09-09T00:00:00Z',
  issues: [],
  context: {},
  droppedContextKeys: [],
});
const accepted: AlertSendResult = { kind: 'sent', code: 'accepted' };
const rejected: AlertSendResult = { kind: 'retryable', code: 'provider_rate_limited' };
const fixture = () => {
  const store = new CasStore();
  let time = 1_000_000;
  let sequence = 0;
  const send = vi.fn(async (): Promise<AlertSendResult> => accepted);
  const queue = (sender = send) =>
    createAlertQueue({
      store,
      send: sender,
      now: () => time,
      id: () => `server-${++sequence}`,
      delay: async () => {},
    });
  return {
    store,
    send,
    queue,
    advance: (ms: number) => {
      time += ms;
    },
    job: () => store.ledger!.jobs[0],
  };
};
const deferred = () => {
  let resolve!: (value: AlertSendResult) => void;
  const promise = new Promise<AlertSendResult>(done => {
    resolve = done;
  });
  let started!: () => void;
  const ready = new Promise<void>(done => {
    started = done;
  });
  const send = vi.fn(() => {
    started();
    return promise;
  });
  return { resolve, ready, send };
};

describe('durable telemetry alert queue', () => {
  it('coalesces concurrent independent producers and workers without duplicate sends', async () => {
    const f = fixture();
    const results = await Promise.all(Array.from({ length: 6 }, () => f.queue().enqueue(event())));
    expect(new Set(results.map(result => result.id)).size).toBe(1);
    const id = results[0].id!;
    await Promise.all(Array.from({ length: 6 }, () => f.queue().deliver(id)));
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.job()).toMatchObject({ id, state: 'sent', attempts: 1 });
    expect(f.store.ledger!.sendTimestamps).toHaveLength(1);
  });

  it('preserves distinct concurrent operations without lost updates', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 6 }, (_, i) => f.queue().enqueue(event(`op-${i}`))));
    expect(f.store.ledger!.jobs).toHaveLength(6);
  });

  it('retries explicit 429 from a fresh instance and does not reset duplicate retry state', async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce(rejected);
    const { id } = await f.queue().enqueue(event());
    expect(await f.queue().deliver(id!)).toEqual({ alert: 'retry_scheduled', id });
    const saved = structuredClone(f.job());
    const duplicate = { ...event(), status: 'partial' as const };
    expect(await f.queue().enqueue(duplicate)).toEqual({ alert: 'queued', id });
    expect(f.job()).toEqual(saved);
    expect(await f.queue().deliver(id!)).toEqual({ alert: 'throttled', id });
    f.advance(60_000);
    expect(await f.queue().deliver(id!)).toEqual({ alert: 'sent', id });
    expect(f.job().attempts).toBe(2);
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it('never resets a sending lease on duplicate enqueue', async () => {
    const f = fixture();
    const slow = deferred();
    const { id } = await f.queue().enqueue(event());
    const delivery = f.queue(slow.send).deliver(id!);
    await slow.ready;
    const claimed = structuredClone(f.job());
    await f.queue().enqueue({ ...event(), status: 'partial' });
    expect(f.job()).toEqual(claimed);
    slow.resolve(accepted);
    await delivery;
  });

  it('uses one-minute then five-minute delays and exhausts at three attempts', async () => {
    const f = fixture();
    f.send.mockResolvedValue(rejected);
    const { id } = await f.queue().enqueue(event());
    await f.queue().deliver(id!);
    expect(f.job().nextDueAt - f.job().lastAttemptAt!).toBe(60_000);
    f.advance(60_000);
    await f.queue().deliver(id!);
    expect(f.job().nextDueAt - f.job().lastAttemptAt!).toBe(300_000);
    f.advance(300_000);
    expect((await f.queue().deliver(id!)).alert).toBe('failed');
    f.advance(300_000);
    await f.queue().deliver(id!);
    expect(f.job()).toMatchObject({ state: 'failed', attempts: 3 });
    expect(f.send).toHaveBeenCalledTimes(3);
  });

  it('starts success cooldown at sentAt, not enqueue or the first failed attempt', async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce(rejected);
    const { id } = await f.queue().enqueue(event());
    await f.queue().deliver(id!);
    f.advance(policy.cooldownMs);
    await f.queue().deliver(id!);
    expect((await f.queue().enqueue(event())).alert).toBe('throttled');
    f.advance(policy.cooldownMs - 1);
    expect((await f.queue().enqueue(event())).alert).toBe('throttled');
    f.advance(1);
    const next = await f.queue().enqueue(event());
    expect(next.alert).toBe('queued');
    expect(next.id).not.toBe(id);
    expect(f.store.ledger!.jobs).toHaveLength(1);
  });

  it.each(['read', 'write'] as const)(
    'fails closed when claim storage %s is unavailable',
    async mode => {
      const f = fixture();
      const { id } = await f.queue().enqueue(event());
      if (mode === 'read') f.store.offline = true;
      else vi.spyOn(f.store, 'compareAndSet').mockRejectedValue(new Error('storage_unavailable'));
      await expect(f.queue().deliver(id!)).rejects.toThrow('storage_unavailable');
      expect(f.send).not.toHaveBeenCalled();
    }
  );

  it('records expired crash leases as uncertain and never retries accepted-but-unrecorded mail', async () => {
    const f = fixture();
    const { id } = await f.queue().enqueue(event());
    f.send.mockImplementation(async () => {
      f.store.offline = true;
      return accepted;
    });
    await expect(f.queue().deliver(id!)).rejects.toThrow('storage_unavailable');
    expect(f.job().state).toBe('sending');
    f.store.offline = false;
    f.advance(policy.leaseMs);
    expect(await f.queue().deliver(id!)).toEqual({ alert: 'uncertain', id });
    expect(f.job()).toMatchObject({ state: 'uncertain', code: 'lease_expired', attempts: 1 });
    await f.queue().drain();
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('fences delayed completion after lease expiry and a replacement job', async () => {
    const f = fixture();
    const slow = deferred();
    const { id } = await f.queue().enqueue(event());
    const delivery = f.queue(slow.send).deliver(id!);
    await slow.ready;
    f.advance(policy.leaseMs);
    await f.queue().drain();
    expect(f.job().state).toBe('uncertain');
    f.advance(policy.cooldownMs);
    const replacement = await f.queue().enqueue(event());
    await f.queue().deliver(replacement.id!);
    const receipt = structuredClone(f.job());
    slow.resolve(accepted);
    await delivery;
    expect(f.job()).toEqual(receipt);
    expect(f.job().id).toBe(replacement.id);
  });

  it('rejects late completion even without another worker first cleaning the lease', async () => {
    const f = fixture();
    const slow = deferred();
    const { id } = await f.queue().enqueue(event());
    const delivery = f.queue(slow.send).deliver(id!);
    await slow.ready;
    f.advance(policy.leaseMs);
    slow.resolve(accepted);
    expect((await delivery).alert).toBe('uncertain');
  });

  it.each([
    { kind: 'permanent', code: 'provider_rejected', state: 'failed' },
    { kind: 'uncertain', code: 'delivery_unconfirmed', state: 'uncertain' },
  ] as const)('persists $kind without retrying', async ({ kind, code, state }) => {
    const f = fixture();
    f.send.mockResolvedValue({ kind, code });
    const { id } = await f.queue().enqueue(event());
    expect((await f.queue().deliver(id!)).alert).toBe(state);
    await f.queue().deliver(id!);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.job().code).toBe(code);
  });

  it('never stores thrown errors or unchecked provider codes', async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(new Error('secret-token'));
    const first = await f.queue().enqueue(event());
    expect((await f.queue().deliver(first.id!)).alert).toBe('uncertain');
    f.send.mockResolvedValueOnce({
      kind: 'permanent',
      code: 'secret-token',
    } as unknown as AlertSendResult);
    const second = await f.queue().enqueue(event('other'));
    await f.queue().deliver(second.id!);
    expect(JSON.stringify(f.store.ledger)).not.toContain('secret-token');
    expect(f.store.ledger!.jobs[1].code).toBe('provider_rejected');
  });

  it('enforces the shared rolling budget under independent concurrent workers', async () => {
    const f = fixture();
    const ids: string[] = [];
    for (let i = 0; i < 16; i++) ids.push((await f.queue().enqueue(event(`op-${i}`))).id!);
    for (let i = 0; i < 16; i += 4)
      await Promise.all(ids.slice(i, i + 4).map(id => f.queue().deliver(id)));
    expect(f.send).toHaveBeenCalledTimes(12);
    expect(f.store.ledger!.sendTimestamps).toHaveLength(12);
    expect(f.store.ledger!.jobs.filter(job => job.state === 'pending')).toHaveLength(4);
    f.advance(policy.budgetWindowMs);
    expect((await f.queue().drain()).sent).toBe(2);
    expect(f.send).toHaveBeenCalledTimes(14);
  });

  it('drains oldest-first and defaults to two jobs per invocation', async () => {
    const f = fixture();
    for (const name of ['first', 'second', 'third']) {
      await f.queue().enqueue(event(name));
      f.advance(1);
    }
    expect(await f.queue().drain()).toMatchObject({ processed: 2, sent: 2 });
    expect(f.store.ledger!.jobs.map(job => job.state)).toEqual(['sent', 'sent', 'pending']);
  });

  it('bounds slots, turns expired pending into retained receipts, and frees after seven days', async () => {
    const f = fixture();
    for (let i = 0; i < policy.maxSlots; i++) await f.queue().enqueue(event(`op-${i}`));
    expect((await f.queue().enqueue(event('overflow'))).alert).toBe('queue_full');
    f.advance(policy.pendingTtlMs);
    await f.queue().drain();
    expect(
      f.store.ledger!.jobs.every(job => job.state === 'failed' && job.code === 'expired')
    ).toBe(true);
    expect(f.store.ledger!.jobs).toHaveLength(64);
    f.advance(policy.receiptTtlMs - 1);
    expect((await f.queue().enqueue(event('overflow'))).alert).toBe('queue_full');
    f.advance(1);
    expect((await f.queue().enqueue(event('overflow'))).alert).toBe('queued');
    expect(f.store.ledger!.jobs).toHaveLength(1);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('does not send when storage acknowledges a claim after its lease expires', async () => {
    const f = fixture();
    const { id } = await f.queue().enqueue(event());
    const cas = f.store.compareAndSet.bind(f.store);
    vi.spyOn(f.store, 'compareAndSet').mockImplementation(async (ledger, etag) => {
      const committed = await cas(ledger, etag);
      if (ledger.jobs[0].state === 'sending') f.advance(policy.leaseMs);
      return committed;
    });
    expect((await f.queue().deliver(id!)).alert).toBe('uncertain');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('does not finalize another fencing token even when the job ID matches', async () => {
    const f = fixture();
    const slow = deferred();
    const { id } = await f.queue().enqueue(event());
    const delivery = f.queue(slow.send).deliver(id!);
    await slow.ready;
    f.job().leaseToken = 'different-owner';
    f.store.revision++;
    slow.resolve(accepted);
    expect((await delivery).alert).toBe('throttled');
    expect(f.job()).toMatchObject({ state: 'sending', leaseToken: 'different-owner' });
  });

  it('bounds CAS contention and never sends before a successful claim', async () => {
    const f = fixture();
    const { id } = await f.queue().enqueue(event());
    f.store.reject = true;
    f.store.writes = 0;
    await expect(f.queue().deliver(id!)).rejects.toThrow('alert_ledger_contention');
    expect(f.store.writes).toBe(8);
    expect(f.job()).toMatchObject({ state: 'pending', attempts: 0 });
    expect(f.send).not.toHaveBeenCalled();
  });
});
