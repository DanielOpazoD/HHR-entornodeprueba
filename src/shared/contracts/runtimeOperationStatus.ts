/**
 * Canonical runtime status for any clinical write/sync operation. Replaces the
 * ad-hoc booleans (`isLoading`, `hasError`, `pending`, `offline`) and the
 * disparate string literals scattered across UI components, sync controllers
 * and operational telemetry. The set is closed and ordered by progression:
 *
 *  - ready    → operation completed, local + remote agree
 *  - saving   → write in flight, awaiting confirmation
 *  - pending  → queued (offline outbox, sync backpressure)
 *  - conflict → divergent state detected, needs resolution
 *  - blocked  → validation or permission blocked the write
 *  - offline  → no connectivity, local-only mode
 *  - degraded → working but with caveat (partial, fallback)
 *  - failed   → unrecoverable error
 *
 * Use the helpers below to classify behaviour without re-implementing the
 * mapping in each consumer (UI badges, sync banners, telemetry).
 */
export type RuntimeOperationStatus =
  | 'ready'
  | 'saving'
  | 'pending'
  | 'conflict'
  | 'blocked'
  | 'offline'
  | 'degraded'
  | 'failed';

export type RuntimeOperationSeverity = 'ok' | 'warning' | 'error';

export const RUNTIME_OPERATION_STATUSES: readonly RuntimeOperationStatus[] = [
  'ready',
  'saving',
  'pending',
  'conflict',
  'blocked',
  'offline',
  'degraded',
  'failed',
] as const;

const SEVERITY_BY_STATUS: Readonly<Record<RuntimeOperationStatus, RuntimeOperationSeverity>> = {
  ready: 'ok',
  saving: 'ok',
  pending: 'warning',
  conflict: 'warning',
  blocked: 'warning',
  offline: 'warning',
  degraded: 'warning',
  failed: 'error',
};

export const getRuntimeOperationSeverity = (
  status: RuntimeOperationStatus
): RuntimeOperationSeverity => SEVERITY_BY_STATUS[status];

/**
 * True when the operation has settled and is not expected to transition again
 * without external input. UI can stop showing spinners / pending dots.
 */
export const isTerminalRuntimeStatus = (status: RuntimeOperationStatus): boolean =>
  status === 'ready' || status === 'failed';

/**
 * True when the operation is mid-flight from the user's point of view (write
 * sent, queued, or about to be retried). UI should keep affordances disabled
 * and show a progress indicator.
 */
export const isInFlightRuntimeStatus = (status: RuntimeOperationStatus): boolean =>
  status === 'saving' || status === 'pending';

/**
 * True when the user must take an explicit decision before the operation can
 * complete (resolve conflict, accept rollback, retry after permission grant).
 */
export const isBlockingRuntimeStatus = (status: RuntimeOperationStatus): boolean =>
  status === 'conflict' || status === 'blocked' || status === 'failed';

export interface RuntimeOperationStatusSnapshot {
  status: RuntimeOperationStatus;
  severity: RuntimeOperationSeverity;
  /** True when an existing in-flight or queued attempt is still progressing. */
  inFlight: boolean;
  /** True when the operation has settled (either ok or unrecoverable). */
  terminal: boolean;
  /** True when the user must intervene before progression is possible. */
  blocking: boolean;
}

export const buildRuntimeOperationStatusSnapshot = (
  status: RuntimeOperationStatus
): RuntimeOperationStatusSnapshot => ({
  status,
  severity: getRuntimeOperationSeverity(status),
  inFlight: isInFlightRuntimeStatus(status),
  terminal: isTerminalRuntimeStatus(status),
  blocking: isBlockingRuntimeStatus(status),
});
