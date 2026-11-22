import type { DailyRecord } from '@/types/domain/dailyRecord';
import { logger } from '@/services/utils/loggerService';
import { isValidRemoteAuthorityRecord } from '@/services/repositories/dailyRecordRemotePersistenceState';

export interface RemoteAuthorityWriteResult {
  recordState?: {
    lastUpdated: string;
    meta: Record<string, unknown>;
    record: DailyRecord;
  };
}

/** Renews the pre-outbox hold every `everyMs` while the remote step is in flight. */
export interface PreOutboxHoldRenewal {
  renewLocalPreOutboxHold: () => Promise<void>;
  everyMs: number;
}

/**
 * `missing`: the server has no confirmed version of this write yet. `unavailable`: the readback
 * itself failed, so nothing is known about the server copy. Both keep the edit blocked.
 */
export type RemoteAuthorityReadback =
  | { kind: 'confirmed'; record: DailyRecord }
  | { kind: 'missing' }
  | { kind: 'unavailable'; error: unknown };

export const runWithOptionalPreOutboxRenewal = async <T>(
  remoteStep: () => Promise<T>,
  renewal?: PreOutboxHoldRenewal
): Promise<T> => {
  if (!renewal || !(renewal.everyMs > 0)) {
    return remoteStep();
  }

  const intervalId = globalThis.setInterval(() => {
    renewal
      .renewLocalPreOutboxHold()
      .catch(error => logger.warn('Failed to renew local pre-outbox hold', error));
  }, renewal.everyMs);

  try {
    return await remoteStep();
  } finally {
    globalThis.clearInterval(intervalId);
  }
};

const applyRemoteAuthorityState = (
  record: DailyRecord,
  result: RemoteAuthorityWriteResult | void
): DailyRecord | null => {
  const recordState = result?.recordState;
  const authoritativeRecord = recordState?.record;
  if (
    !recordState ||
    typeof recordState.lastUpdated !== 'string' ||
    !recordState.lastUpdated ||
    !recordState.meta ||
    typeof recordState.meta !== 'object' ||
    Array.isArray(recordState.meta) ||
    !authoritativeRecord ||
    typeof authoritativeRecord !== 'object' ||
    Array.isArray(authoritativeRecord) ||
    authoritativeRecord.date !== record.date ||
    authoritativeRecord.lastUpdated !== recordState.lastUpdated
  ) {
    return null;
  }
  return authoritativeRecord;
};

/** Waits before re-reading a readback that still shows the pre-write version. */
const PRE_COMMIT_READBACK_RETRY_DELAYS_MS = [250, 750] as const;

const isSameVersion = (left: string, right: string | undefined): boolean =>
  right !== undefined && (left === right || Date.parse(left) === Date.parse(right));

const wait = (ms: number) => new Promise<void>(resolve => globalThis.setTimeout(resolve, ms));

/**
 * Prefer the record the write itself returned. Older authority callables, the direct updateDoc
 * path and an atomic patch whose commit could not be projected return none, so read the committed
 * document instead. That server read can be answered by an attached listener that has not seen
 * this commit yet: a readback still at the write's base version is retried briefly, then rejected
 * so the caller fails closed instead of adopting the pre-write record.
 *
 * Only that exact version is rejected, because lastUpdated comes from client clocks and cannot be
 * ordered safely. Two stale views still pass when the write returned no record: a listener view
 * older than the base, and, after a stale-version rebase, one at the retried write's own base
 * (callers pass the original expectedVersion). Rebase is not offered to atomic or
 * remote-authority-first writes, so the second needs a callable that returns no recordState.
 */
export const resolveRemoteAuthorityRecord = async (
  record: DailyRecord,
  result: RemoteAuthorityWriteResult | void,
  readRemoteConfirmedRecord?: () => Promise<DailyRecord | null>,
  expectedVersion?: string
): Promise<RemoteAuthorityReadback> => {
  const responseRecord = applyRemoteAuthorityState(record, result);
  if (responseRecord) return { kind: 'confirmed', record: responseRecord };
  if (!readRemoteConfirmedRecord) return { kind: 'missing' };

  for (let attempt = 0; ; attempt += 1) {
    let remoteRecord: DailyRecord | null;
    try {
      remoteRecord = await readRemoteConfirmedRecord();
    } catch (error) {
      logger.warn('Could not read back the server-confirmed daily record', error);
      return { kind: 'unavailable', error };
    }
    if (!isValidRemoteAuthorityRecord(remoteRecord, record.date)) return { kind: 'missing' };
    if (!isSameVersion(remoteRecord.lastUpdated, expectedVersion))
      return { kind: 'confirmed', record: remoteRecord };

    const delayMs = PRE_COMMIT_READBACK_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined) {
      logger.warn('The server readback still shows the pre-write daily record', {
        date: record.date,
      });
      return { kind: 'missing' };
    }
    await wait(delayMs);
  }
};

/**
 * The read failure travels as `cause` of a code-less error, so the save keeps the same blocked,
 * non-retryable classification it had when this failure was reported as a missing version.
 */
export const unconfirmedRemoteAuthorityError = (
  readback: Exclude<RemoteAuthorityReadback, { kind: 'confirmed' }>
): Error =>
  readback.kind === 'unavailable'
    ? new Error('No se pudo leer en el servidor la versión confirmada del registro.', {
        cause: readback.error,
      })
    : new Error('La autoridad remota no devolvió la versión confirmada del registro.');
