import { randomUUID } from 'node:crypto';
import {
  ALERT_QUEUE_POLICY as policy,
  emptyLedger,
  finishJob,
  isTerminal,
  jobResult,
  maintainLedger,
  safeSendResult,
} from './queuePolicy';
import type {
  AlertEvent,
  AlertJob,
  AlertLedger,
  AlertQueue,
  AlertQueueOptions,
  AlertSendResult,
  DeliverResult,
  DrainResult,
  EnqueueResult,
} from './queueTypes';
export type * from './queueTypes';
export { ALERT_CODES } from './queueTypes';
export { ALERT_QUEUE_POLICY } from './queuePolicy';

export const createAlertQueue = (options: AlertQueueOptions): AlertQueue => {
  const { store, send } = options;
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const delay = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

  // Only pure in-memory ledger transformations belong here. No mail or other I/O.
  const mutate = async <T>(change: (ledger: AlertLedger, time: number) => T): Promise<T> => {
    for (let attempt = 0; attempt < policy.casAttempts; attempt++) {
      const stored = await store.read();
      const ledger = stored ? structuredClone(stored.ledger) : emptyLedger();
      const time = now();
      if (!Number.isFinite(time)) throw new Error('alert_clock_invalid');
      maintainLedger(ledger, time);
      const result = change(ledger, time);
      if (await store.compareAndSet(ledger, stored?.etag ?? null)) return result;
      if (attempt + 1 < policy.casAttempts) await delay(1 + Math.floor(Math.random() * 5));
    }
    throw new Error('alert_ledger_contention');
  };

  const enqueue = async (event: AlertEvent): Promise<EnqueueResult> => {
    const jobId = id();
    // Clone before awaiting storage so callers cannot change the accepted event mid-enqueue.
    const sanitized = structuredClone(event);
    return mutate((ledger, time) => {
      const index = ledger.jobs.findIndex(job => job.operation === sanitized.operation);
      const previous = ledger.jobs[index];
      if (previous) {
        if (!isTerminal(previous)) return { alert: 'queued', id: previous.id };
        const cooldownStart = previous.state === 'sent' ? previous.sentAt! : previous.terminalAt!;
        if (time - cooldownStart < policy.cooldownMs) {
          return { alert: 'throttled', id: previous.id };
        }
      } else if (ledger.jobs.length >= policy.maxSlots) {
        return { alert: 'queue_full' };
      }
      if (ledger.jobs.some(job => job.id === jobId)) throw new Error('alert_id_collision');
      const job: AlertJob = {
        id: jobId,
        operation: sanitized.operation,
        event: sanitized,
        state: 'pending',
        attempts: 0,
        createdAt: time,
        updatedAt: time,
        expiresAt: time + policy.pendingTtlMs,
        nextDueAt: time,
      };
      if (previous) ledger.jobs[index] = job;
      else ledger.jobs.push(job);
      return { alert: 'queued', id: jobId };
    });
  };

  const deliver = async (jobId: string): Promise<DeliverResult> => {
    const leaseToken = id();
    const claim = await mutate<{ job: AlertJob } | { result: DeliverResult }>((ledger, time) => {
      const job = ledger.jobs.find(candidate => candidate.id === jobId);
      if (!job || job.state !== 'pending') return { result: jobResult(job, jobId) };
      if (
        options.canClaim?.() === false ||
        job.nextDueAt > time ||
        ledger.sendTimestamps.length >= policy.maxSends
      ) {
        return { result: { alert: 'throttled', id: jobId } };
      }
      job.state = 'sending';
      job.attempts++;
      job.updatedAt = time;
      job.lastAttemptAt = time;
      job.leaseToken = leaseToken;
      job.leaseUntil = time + policy.leaseMs;
      ledger.sendTimestamps.push(time);
      return { job: structuredClone(job) };
    });
    if ('result' in claim) return claim.result;
    // Slow storage may acknowledge an already-expired lease. Never start mail with it.
    if (now() >= claim.job.leaseUntil!) {
      return mutate(ledger =>
        jobResult(
          ledger.jobs.find(job => job.id === jobId),
          jobId
        )
      );
    }
    let outcome: AlertSendResult;
    try {
      outcome = safeSendResult(await send(claim.job.event, claim.job.id));
    } catch {
      // An exception proves nothing about provider acceptance. Do not retry automatically.
      outcome = { kind: 'uncertain', code: 'delivery_unconfirmed' };
    }
    return mutate((ledger, time) => {
      const job = ledger.jobs.find(candidate => candidate.id === jobId);
      if (!job || job.state !== 'sending' || job.leaseToken !== leaseToken) {
        return jobResult(job, jobId);
      }
      if (outcome.kind === 'retryable' && job.attempts < policy.maxAttempts) {
        job.state = 'pending';
        job.code = outcome.code;
        job.updatedAt = time;
        job.nextDueAt = time + policy.retryDelaysMs[job.attempts - 1];
        delete job.leaseToken;
        delete job.leaseUntil;
        // Expiration remains anchored to the original enqueue, including slow rejections.
        if (job.expiresAt <= time) {
          finishJob(job, 'failed', 'expired', time);
          return { alert: 'failed', id: jobId };
        }
        return { alert: 'retry_scheduled', id: jobId };
      }
      const state =
        outcome.kind === 'sent' ? 'sent' : outcome.kind === 'uncertain' ? 'uncertain' : 'failed';
      finishJob(job, state, outcome.code, time);
      return { alert: state, id: jobId };
    });
  };

  const drain = async (limit = 2): Promise<DrainResult> => {
    // A bounded scan is committed even when there is nothing due, persisting stale leases.
    const count = Number.isFinite(limit)
      ? Math.min(policy.maxSlots, Math.max(0, Math.floor(limit)))
      : 2;
    const due = await mutate((ledger, time) =>
      ledger.jobs
        .filter(job => job.state === 'pending' && job.nextDueAt <= time)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .slice(0, count)
        .map(job => job.id)
    );
    const counts: DrainResult = {
      processed: 0,
      sent: 0,
      retry_scheduled: 0,
      failed: 0,
      uncertain: 0,
      throttled: 0,
    };
    for (const jobId of due) {
      const result = await deliver(jobId);
      counts.processed++;
      counts[result.alert]++;
    }
    return counts;
  };
  return { enqueue, deliver, drain };
};
