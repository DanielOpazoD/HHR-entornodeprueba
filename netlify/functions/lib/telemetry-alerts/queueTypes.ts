import type { SanitizedOperationalTelemetryEvent } from '../../../../src/services/observability/operationalTelemetryIngestPolicy';

export type AlertEvent = SanitizedOperationalTelemetryEvent;
export type AlertState = 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';
export const ALERT_CODES = [
  'accepted',
  'provider_rate_limited',
  'provider_rejected',
  'delivery_unconfirmed',
  'mail_not_configured',
  'expired',
  'lease_expired',
] as const;
export type AlertCode = (typeof ALERT_CODES)[number];
export interface AlertSendResult {
  kind: 'sent' | 'retryable' | 'permanent' | 'uncertain';
  code: AlertCode;
}

/** All times are server epoch milliseconds. One latest job/receipt per operation. */
export interface AlertJob {
  id: string;
  operation: string;
  event: AlertEvent;
  state: AlertState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  nextDueAt: number;
  lastAttemptAt?: number;
  leaseToken?: string;
  leaseUntil?: number;
  terminalAt?: number;
  sentAt?: number;
  code?: AlertCode;
}
export interface AlertLedger {
  version: 1;
  jobs: AlertJob[];
  /** Rolling ten-minute claim budget, bounded to twelve timestamps. */
  sendTimestamps: number[];
}
export interface AlertLedgerStore {
  read(): Promise<{ ledger: AlertLedger; etag: string } | null>;
  compareAndSet(ledger: AlertLedger, etag: string | null): Promise<boolean>;
}
export interface EnqueueResult {
  alert: 'queued' | 'throttled' | 'queue_full';
  id?: string;
}
export interface DeliverResult {
  alert: 'sent' | 'retry_scheduled' | 'failed' | 'uncertain' | 'throttled';
  id?: string;
}
export interface DrainResult {
  processed: number;
  sent: number;
  retry_scheduled: number;
  failed: number;
  uncertain: number;
  throttled: number;
}
export interface AlertQueueOptions {
  store: AlertLedgerStore;
  /** Called outside CAS, only after the lease and budget consumption are durable. */
  send(event: AlertEvent, id: string): Promise<AlertSendResult>;
  now?: () => number;
  /** Do not start provider work when the invocation cannot safely finish it. */
  canClaim?: () => boolean;
  /** Must generate globally unique server IDs; also used for fencing tokens. */
  id?: () => string;
  delay?: (milliseconds: number) => Promise<void>;
}
export interface AlertQueue {
  enqueue(event: AlertEvent): Promise<EnqueueResult>;
  deliver(id: string): Promise<DeliverResult>;
  drain(limit?: number): Promise<DrainResult>;
}
