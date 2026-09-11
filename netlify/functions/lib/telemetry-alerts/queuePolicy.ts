import { ALERT_CODES } from './queueTypes';
import type {
  AlertCode,
  AlertJob,
  AlertLedger,
  AlertSendResult,
  DeliverResult,
} from './queueTypes';

export const ALERT_QUEUE_POLICY = {
  maxSlots: 64,
  maxAttempts: 3,
  casAttempts: 8,
  leaseMs: 60_000,
  pendingTtlMs: 24 * 60 * 60_000,
  receiptTtlMs: 7 * 24 * 60 * 60_000,
  cooldownMs: 10 * 60_000,
  budgetWindowMs: 10 * 60_000,
  maxSends: 12,
  retryDelaysMs: [60_000, 5 * 60_000],
} as const;

export const emptyLedger = (): AlertLedger => ({ version: 1, jobs: [], sendTimestamps: [] });
export const isTerminal = (job: AlertJob): boolean =>
  job.state === 'sent' || job.state === 'failed' || job.state === 'uncertain';

export const finishJob = (
  job: AlertJob,
  state: 'sent' | 'failed' | 'uncertain',
  code: AlertCode,
  now: number
): void => {
  job.state = state;
  job.code = code;
  job.updatedAt = now;
  job.terminalAt = now;
  if (state === 'sent') job.sentAt = now;
  delete job.leaseToken;
  delete job.leaseUntil;
};

/** Invalid durable state is a storage failure, never permission to send. */
export const validateLedger = (ledger: AlertLedger): void => {
  if (
    ledger.version !== 1 ||
    !Array.isArray(ledger.jobs) ||
    ledger.jobs.length > ALERT_QUEUE_POLICY.maxSlots ||
    !Array.isArray(ledger.sendTimestamps) ||
    ledger.sendTimestamps.length > ALERT_QUEUE_POLICY.maxSends ||
    ledger.sendTimestamps.some(time => !Number.isFinite(time))
  )
    throw new Error('alert_ledger_invalid');
  const operations = new Set<string>();
  const ids = new Set<string>();
  for (const job of ledger.jobs) {
    if (
      !job.id ||
      !job.operation ||
      !job.event ||
      job.event.operation !== job.operation ||
      operations.has(job.operation) ||
      ids.has(job.id) ||
      !['pending', 'sending', 'sent', 'failed', 'uncertain'].includes(job.state) ||
      !Number.isInteger(job.attempts) ||
      job.attempts < 0 ||
      job.attempts > ALERT_QUEUE_POLICY.maxAttempts ||
      ![job.createdAt, job.updatedAt, job.expiresAt, job.nextDueAt].every(Number.isFinite) ||
      (job.state === 'sending' && (!job.leaseToken || !Number.isFinite(job.leaseUntil))) ||
      (isTerminal(job) && !Number.isFinite(job.terminalAt)) ||
      (job.state === 'sent' && !Number.isFinite(job.sentAt)) ||
      (job.code !== undefined && !ALERT_CODES.includes(job.code))
    )
      throw new Error('alert_ledger_invalid');
    operations.add(job.operation);
    ids.add(job.id);
  }
};

/** Run in every CAS transaction, including otherwise read-only/throttled requests. */
export const maintainLedger = (ledger: AlertLedger, now: number): void => {
  validateLedger(ledger);
  ledger.sendTimestamps = ledger.sendTimestamps.filter(
    time => time > now - ALERT_QUEUE_POLICY.budgetWindowMs
  );
  for (const job of ledger.jobs) {
    if (job.state === 'sending' && job.leaseUntil! <= now) {
      // The provider may have accepted before a crash. Never requeue an expired lease.
      finishJob(job, 'uncertain', 'lease_expired', now);
    } else if (job.state === 'pending' && job.expiresAt <= now) {
      finishJob(job, 'failed', 'expired', now);
    } else if (job.state === 'pending' && job.attempts >= ALERT_QUEUE_POLICY.maxAttempts) {
      finishJob(job, 'failed', 'provider_rejected', now);
    }
  }
  ledger.jobs = ledger.jobs.filter(
    job => !isTerminal(job) || now - job.terminalAt! < ALERT_QUEUE_POLICY.receiptTtlMs
  );
};

/** Even a misbehaving adapter cannot persist provider payloads, errors or credentials. */
export const safeSendResult = (result: AlertSendResult): AlertSendResult => {
  const fallback = { kind: 'uncertain', code: 'delivery_unconfirmed' } as const;
  if (!result || !['sent', 'retryable', 'permanent', 'uncertain'].includes(result.kind)) {
    return fallback;
  }
  if (ALERT_CODES.includes(result.code)) return { kind: result.kind, code: result.code };
  const code: AlertCode =
    result.kind === 'sent'
      ? 'accepted'
      : result.kind === 'retryable'
        ? 'provider_rate_limited'
        : result.kind === 'permanent'
          ? 'provider_rejected'
          : 'delivery_unconfirmed';
  return { kind: result.kind, code };
};

export const jobResult = (job: AlertJob | undefined, id: string): DeliverResult => ({
  alert: job && isTerminal(job) ? (job.state as 'sent' | 'failed' | 'uncertain') : 'throttled',
  id,
});
