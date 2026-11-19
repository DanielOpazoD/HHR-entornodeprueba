import {
  assertAuthoringSessionCurrent,
  isAuthoringSessionCurrent,
  type AuthoringSession,
} from '@/services/storage/authoringSession';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { saveRecordStrict as saveToIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { logger } from '@/services/utils/loggerService';
import { resolveRemoteWriteRecovery } from '@/services/repositories/dailyRecordRemoteWriteController';
import {
  sessionEndedWriteOutcome,
  settleWriteResult,
  startWriteResult,
  type RemoteWriteStep,
} from '@/services/repositories/dailyRecordWriteState';
import type { SyncQueueEnqueueResult } from '@/services/storage/sync';
import {
  confirmedByServer,
  isValidRemoteAuthorityRecord,
  localCopyStale,
  notStored,
  recoverAlreadyAppliedRemoteWrite,
  storedHere,
  toWriteError,
} from '@/services/repositories/dailyRecordRemotePersistenceState';
import {
  attemptStaleVersionRebaseRetry,
  type StaleVersionRebaseRetryHooks,
} from '@/services/repositories/dailyRecordStaleVersionRebase';
import { persistConfirmedRemoteRecordLocally } from '@/services/repositories/dailyRecordConfirmedLocalPersistence';

export interface RemoteAuthorityWriteResult {
  recordState?: {
    lastUpdated: string;
    meta: Record<string, unknown>;
    record: DailyRecord;
  };
}

/** The outbox refused the write before anything was stored with its task. */
const rejectedByOutbox = (
  current: Parameters<typeof notStored>[0],
  { mode }: SyncQueueEnqueueResult
) => {
  if (mode === 'retained_for_owner') {
    return notStored(
      current,
      new Error('La sesión cambió antes de guardar; el cambio quedó para su usuario original.'),
      'La sesión cambió antes de guardar. El cambio quedó pendiente para la persona que lo hizo.',
      'session_changed'
    );
  }
  return mode === 'rejected_backpressure'
    ? notStored(
        current,
        new Error(
          'La cola de sincronización alcanzó su límite operativo antes de confirmar la persistencia local.'
        ),
        'La cola de sincronización alcanzó su límite operativo. Revisa conectividad o libera tareas pendientes antes de reintentar.'
      )
    : notStored(
        current,
        new Error('La cola de sincronización no pudo confirmar la persistencia local.'),
        'No fue posible guardar el registro local junto a su tarea de sincronización.'
      );
};

const runWithOptionalPreOutboxRenewal = async <T>(
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
 * `missing`: the server has no confirmed version of this write yet. `unavailable`: the readback
 * itself failed, so nothing is known about the server copy. Both keep the edit blocked.
 */
type RemoteAuthorityReadback =
  | { kind: 'confirmed'; record: DailyRecord }
  | { kind: 'missing' }
  | { kind: 'unavailable'; error: unknown };

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
const resolveRemoteAuthorityRecord = async (
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
const unconfirmedRemoteAuthorityError = (
  readback: Exclude<RemoteAuthorityReadback, { kind: 'confirmed' }>
): Error =>
  readback.kind === 'unavailable'
    ? new Error('No se pudo leer en el servidor la versión confirmada del registro.', {
        cause: readback.error,
      })
    : new Error('La autoridad remota no devolvió la versión confirmada del registro.');

/** What is written: the day, its record, the paths it changes and the version it expects. */
interface DailyRecordPersistedChange {
  date: string;
  record: DailyRecord;
  changedPaths: string[];
  expectedVersion?: string;
}

/** The server side: the write, the server read of what it committed, and the failure report. */
interface DailyRecordRemoteWriteAttempt {
  remoteWrite: () => Promise<RemoteAuthorityWriteResult | void>;
  /** Compatibility readback when a deployed callable confirms without returning recordState. */
  readRemoteConfirmedRecord?: () => Promise<DailyRecord | null>;
  onRemoteFailure: (error: unknown) => void;
}

/** Renews the pre-outbox hold every `everyMs` while the remote step is in flight. */
interface PreOutboxHoldRenewal {
  renewLocalPreOutboxHold: () => Promise<void>;
  everyMs: number;
}

/** The local outbox task written before the remote write, and how it is closed or released. */
interface PreOutboxLocalRetention {
  queueLocalBeforeRemote?: () => Promise<SyncQueueEnqueueResult>;
  ackLocalAfterRemote?: () => Promise<boolean | void>;
  /** Atomically completes only a confirmed local-first full save and returns retained work. */
  completeConfirmedLocalWrite?: (record: DailyRecord) => Promise<DailyRecord | undefined>;
  releaseLocalPreOutboxHold?: () => Promise<void>;
  preOutboxHoldRenewal?: PreOutboxHoldRenewal;
}

/** How a server-confirmed record is adopted locally. */
interface RemoteRecordAdoption {
  /**
   * A guarded command can lose its CAS race after another writer already reached the same desired
   * state. When that can be proven from a fresh authoritative read, adopt that exact record instead
   * of treating an idempotent command as a failed write.
   */
  resolveAlreadyAppliedRemoteRecord?: (error: unknown) => Promise<DailyRecord | null>;
  /** Reconciles a confirmed guarded record with any exact pending local outbox projection. */
  adoptRemoteAuthorityRecord?: (record: DailyRecord) => Promise<DailyRecord>;
}

interface RemotePersistencePolicy {
  /**
   * Require the exact server-confirmed revision even when the remote adapter returns `void`.
   * Rayen structural imports need this handoff before starting their clinical stage; ordinary
   * application writes keep their existing local-first behaviour.
   */
  requireConfirmedRecord?: boolean;
  /** Some multi-field mutations must be retried from fresh state, never union-merged. */
  allowConflictAutoMerge?: boolean;
  /**
   * Fail-closed path for guarded writes: commit the atomic remote authority check before touching
   * IndexedDB, and never enqueue a rejected stale writer for later replay.
   */
  remoteAuthorityFirst?: boolean;
}

interface PersistLocalAndAttemptRemoteSyncInput {
  change: DailyRecordPersistedChange;
  authoringSession: AuthoringSession;
  remote: DailyRecordRemoteWriteAttempt;
  outbox?: PreOutboxLocalRetention;
  adoption?: RemoteRecordAdoption;
  /** Reintento acotado por versión vieja — ver dailyRecordStaleVersionRebase. */
  staleVersion?: StaleVersionRebaseRetryHooks<RemoteAuthorityWriteResult>;
  policy?: RemotePersistencePolicy;
}

/** Stores the write here and on the server; the step's result says where it ended up. */
export const persistLocalAndAttemptRemoteSync = async ({
  change: { date, record, changedPaths, expectedVersion },
  authoringSession,
  remote: { remoteWrite, readRemoteConfirmedRecord, onRemoteFailure },
  outbox: {
    queueLocalBeforeRemote,
    ackLocalAfterRemote,
    completeConfirmedLocalWrite,
    releaseLocalPreOutboxHold,
    preOutboxHoldRenewal,
  } = {},
  adoption: { resolveAlreadyAppliedRemoteRecord, adoptRemoteAuthorityRecord } = {},
  staleVersion: { retryRemoteWriteOnStaleVersion, canRebaseStaleVersionConflict } = {},
  policy: {
    requireConfirmedRecord = false,
    allowConflictAutoMerge = true,
    remoteAuthorityFirst = false,
  } = {},
}: PersistLocalAndAttemptRemoteSyncInput): Promise<RemoteWriteStep> => {
  let result = startWriteResult(date);
  if (remoteAuthorityFirst) {
    const rejectForeignWrite = (): RemoteWriteStep => {
      recordOperationalTelemetry({
        category: 'sync',
        operation: 'remote_first_write_session_changed',
        status: 'degraded',
        runtimeState: 'recoverable',
        issues: ['La sesión de autoría terminó antes del despacho remoto.'],
      });
      return {
        result: notStored(
          result,
          new Error('La sesión cambió antes de enviar la escritura.'),
          'La sesión cambió. La operación no fue enviada ni guardada.',
          'session_changed'
        ),
        next: 'return',
      };
    };
    if (!isAuthoringSessionCurrent(authoringSession)) return rejectForeignWrite();
    if (!isFirestoreEnabled()) {
      throw new Error('La autoridad remota no está disponible para esta escritura clínica.');
    }
    let remoteResult: RemoteAuthorityWriteResult | void;
    try {
      try {
        remoteResult = await remoteWrite();
      } catch (writeError) {
        const rebased = await attemptStaleVersionRebaseRetry<RemoteAuthorityWriteResult>({
          writeError,
          date,
          hooks: {
            retryRemoteWriteOnStaleVersion: retryRemoteWriteOnStaleVersion
              ? fresh => {
                  assertAuthoringSessionCurrent(authoringSession);
                  return retryRemoteWriteOnStaleVersion(fresh);
                }
              : undefined,
            canRebaseStaleVersionConflict,
          },
          readRemoteConfirmedRecord,
        });
        if (!rebased) throw writeError;
        remoteResult = rebased.result;
      }
    } catch (error) {
      if (!isAuthoringSessionCurrent(authoringSession)) return rejectForeignWrite();
      const alreadyApplied = await recoverAlreadyAppliedRemoteWrite({
        error,
        date,
        current: result,
        resolveAlreadyAppliedRemoteRecord,
        adoptAlreadyAppliedRemoteRecord: adoptRemoteAuthorityRecord,
      });
      if (alreadyApplied) return alreadyApplied;

      onRemoteFailure(error);
      throw error;
    }
    result = confirmedByServer(result);

    const authority = await resolveRemoteAuthorityRecord(
      record,
      remoteResult,
      readRemoteConfirmedRecord,
      expectedVersion
    );
    if (authority.kind !== 'confirmed') {
      return {
        result: localCopyStale(result, unconfirmedRemoteAuthorityError(authority)),
        next: 'return',
      };
    }
    return persistConfirmedRemoteRecordLocally({
      current: { ...result, confirmedRecord: authority.record },
      authoritativeRecord: authority.record,
      adoptRemoteAuthorityRecord,
    });
  }

  if (queueLocalBeforeRemote) {
    const outboxResult = await queueLocalBeforeRemote();
    if (!outboxResult.accepted) {
      return { result: rejectedByOutbox(result, outboxResult), next: 'return' };
    }
  } else {
    const localResult = await saveToIndexedDB(record);
    if (!localResult.ok) {
      const userSafeMessage =
        localResult.userSafeMessage || 'No fue posible guardar el registro local.';
      return {
        result: notStored(
          result,
          toWriteError(localResult.error, userSafeMessage),
          userSafeMessage
        ),
        next: 'return',
      };
    }
  }
  result = storedHere(result);

  if (!isFirestoreEnabled()) {
    return { result, next: 'continue' };
  }

  try {
    let remoteResult: RemoteAuthorityWriteResult | void;
    try {
      remoteResult = await runWithOptionalPreOutboxRenewal(remoteWrite, preOutboxHoldRenewal);
    } catch (writeError) {
      const rebased = await attemptStaleVersionRebaseRetry<RemoteAuthorityWriteResult>({
        writeError,
        date: record.date,
        hooks: { retryRemoteWriteOnStaleVersion, canRebaseStaleVersionConflict },
        readRemoteConfirmedRecord,
      });
      if (!rebased) {
        throw writeError;
      }
      remoteResult = rebased.result;
    }
    result = confirmedByServer(result);
    // Callable-backed writes return an authority payload. A Rayen structural import can also use
    // the direct Firestore adapter (which returns `void`), so that one flow explicitly requests a
    // readback before handing control to the clinical stage.
    if (remoteResult !== undefined || requireConfirmedRecord) {
      // A pre-write readback is retried, so keep the pending outbox task held meanwhile.
      const authority = await runWithOptionalPreOutboxRenewal(
        () =>
          resolveRemoteAuthorityRecord(
            record,
            remoteResult,
            readRemoteConfirmedRecord,
            expectedVersion
          ),
        preOutboxHoldRenewal
      );
      if (authority.kind !== 'confirmed') {
        await releaseLocalPreOutboxHold?.();
        return {
          result: localCopyStale(result, unconfirmedRemoteAuthorityError(authority)),
          next: 'return',
        };
      }
      result = { ...result, confirmedRecord: authority.record };
      const persisted = await persistConfirmedRemoteRecordLocally({
        current: result,
        authoritativeRecord: authority.record,
        adoptRemoteAuthorityRecord,
        completeConfirmedLocalWrite,
        releaseLocalPreOutboxHold,
      });
      if (persisted.next === 'return' || completeConfirmedLocalWrite) return persisted;
      result = persisted.result;
    }
    await ackLocalAfterRemote?.();
    return { result, next: 'continue' };
  } catch (err) {
    // The send stopped because its session ended: the edit stays in its author's queue, for that
    // person to review and resend. Nothing is recovered or shown in the next session.
    if (!isAuthoringSessionCurrent(authoringSession)) {
      await releaseLocalPreOutboxHold?.();
      recordOperationalTelemetry({
        category: 'sync',
        operation: 'direct_send_session_changed',
        status: 'degraded',
        runtimeState: 'recoverable',
        issues: ['La sesión de autoría terminó antes de que el envío directo llegara al servidor.'],
      });
      return {
        result: settleWriteResult(result, sessionEndedWriteOutcome(result)),
        next: 'return',
      };
    }
    onRemoteFailure(err);
    // The write stays held while its recovery runs. Released first, the queue could replay it
    // meanwhile, and a recovery that stores it again would leave a second task for the same edit.
    const current = result;
    try {
      return await runWithOptionalPreOutboxRenewal(
        () =>
          resolveRemoteWriteRecovery({
            date,
            record,
            changedPaths,
            error: err,
            current,
            authoringSession,
            expectedVersion,
            allowConflictAutoMerge,
            localWriteAlreadyQueued: Boolean(queueLocalBeforeRemote),
          }),
        preOutboxHoldRenewal
      );
    } finally {
      await releaseLocalPreOutboxHold?.();
    }
  }
};
