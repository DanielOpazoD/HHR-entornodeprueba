import { classifySyncError } from '@/services/storage/syncErrorCatalog';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  saveRecordStrict as saveToIndexedDB,
  type LocalRecordWriteResult,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  isFirestoreEnabled,
  getFirestoreSyncState,
} from '@/services/repositories/repositoryConfig';
import { logger } from '@/services/utils/loggerService';
import { resolveRemoteWriteRecovery } from '@/services/repositories/dailyRecordRemoteWriteController';
import {
  applyRecoveryDecisionToState,
  type RemoteWriteState,
} from '@/services/repositories/dailyRecordWriteState';
import type { SyncQueueEnqueueResult } from '@/services/storage/sync';
import {
  applyLocalPersistenceFailure,
  isValidRemoteAuthorityRecord,
  markLocalWriteSucceeded,
  markRemoteWriteSucceeded,
  recoverAlreadyAppliedRemoteWrite,
} from '@/services/repositories/dailyRecordRemotePersistenceState';
import { attemptStaleVersionRebaseRetry } from '@/services/repositories/dailyRecordStaleVersionRebase';
import { persistConfirmedRemoteRecordLocally } from '@/services/repositories/dailyRecordConfirmedLocalPersistence';

export interface RemoteAuthorityWriteResult {
  recordState?: {
    lastUpdated: string;
    meta: Record<string, unknown>;
    record: DailyRecord;
  };
}

const toRejectedOutboxPersistenceResult = (
  result: SyncQueueEnqueueResult
): LocalRecordWriteResult => ({
  ok: false,
  operation: 'save',
  store: 'none',
  dates: [],
  error: new Error(
    result.mode === 'rejected_backpressure'
      ? 'La cola de sincronización alcanzó su límite operativo antes de confirmar la persistencia local.'
      : result.mode === 'retained_for_owner'
        ? 'La sesión cambió antes de guardar; el cambio quedó para su usuario original.'
        : 'La cola de sincronización no pudo confirmar la persistencia local.'
  ),
  userSafeMessage:
    result.mode === 'rejected_backpressure'
      ? 'La cola de sincronización alcanzó su límite operativo. Revisa conectividad o libera tareas pendientes antes de reintentar.'
      : result.mode === 'retained_for_owner'
        ? 'La sesión cambió antes de guardar. El cambio quedó pendiente para la persona que lo hizo.'
        : 'No fue posible guardar el registro local junto a su tarea de sincronización.',
});

const runWithOptionalPreOutboxRenewal = async <T>(
  remoteStep: () => Promise<T>,
  renewLocalPreOutboxHold?: () => Promise<void>,
  renewIntervalMs?: number
): Promise<T> => {
  if (!renewLocalPreOutboxHold || !renewIntervalMs || renewIntervalMs <= 0) {
    return remoteStep();
  }

  const intervalId = globalThis.setInterval(() => {
    renewLocalPreOutboxHold().catch(error =>
      logger.warn('Failed to renew local pre-outbox hold', error)
    );
  }, renewIntervalMs);

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
const unconfirmedRemoteAuthorityStateResult = (
  date: string,
  readback: Exclude<RemoteAuthorityReadback, { kind: 'confirmed' }>
): LocalRecordWriteResult => ({
  ok: false,
  operation: 'save',
  store: 'none',
  dates: [date],
  error:
    readback.kind === 'unavailable'
      ? new Error('No se pudo leer en el servidor la versión confirmada del registro.', {
          cause: readback.error,
        })
      : new Error('La autoridad remota no devolvió la versión confirmada del registro.'),
  userSafeMessage: 'La copia local no pudo confirmar la versión guardada en el servidor.',
});

export const persistLocalAndAttemptRemoteSync = async ({
  date,
  record,
  changedPaths,
  remoteState,
  remoteWrite,
  onRemoteFailure,
  expectedVersion,
  queueLocalBeforeRemote,
  ackLocalAfterRemote,
  releaseLocalPreOutboxHold,
  renewLocalPreOutboxHold,
  renewLocalPreOutboxHoldEveryMs,
  readRemoteConfirmedRecord,
  resolveAlreadyAppliedRemoteRecord,
  adoptRemoteAuthorityRecord,
  completeConfirmedLocalWrite,
  retryRemoteWriteOnStaleVersion,
  canRebaseStaleVersionConflict,
  requireConfirmedRecord = false,
  allowConflictAutoMerge = true,
  remoteAuthorityFirst = false,
  allowOfflineQueue = false,
}: {
  date: string;
  record: DailyRecord;
  changedPaths: string[];
  remoteState: RemoteWriteState;
  remoteWrite: () => Promise<RemoteAuthorityWriteResult | void>;
  onRemoteFailure: (error: unknown) => void;
  expectedVersion?: string;
  queueLocalBeforeRemote?: () => Promise<SyncQueueEnqueueResult>;
  ackLocalAfterRemote?: () => Promise<boolean | void>;
  releaseLocalPreOutboxHold?: () => Promise<void>;
  renewLocalPreOutboxHold?: () => Promise<void>;
  renewLocalPreOutboxHoldEveryMs?: number;
  /** Compatibility readback when a deployed callable confirms without returning recordState. */
  readRemoteConfirmedRecord?: () => Promise<DailyRecord | null>;
  /** Reintento acotado por versión vieja — ver dailyRecordStaleVersionRebase. */
  retryRemoteWriteOnStaleVersion?: (
    freshRemoteRecord: DailyRecord
  ) => Promise<RemoteAuthorityWriteResult | void>;
  canRebaseStaleVersionConflict?: (freshRemoteRecord: DailyRecord, writeError: unknown) => boolean;
  /**
   * A guarded command can lose its CAS race after another writer already reached the same desired
   * state. When that can be proven from a fresh authoritative read, adopt that exact record instead
   * of treating an idempotent command as a failed write.
   */
  resolveAlreadyAppliedRemoteRecord?: (error: unknown) => Promise<DailyRecord | null>;
  /** Reconciles a confirmed guarded record with any exact pending local outbox projection. */
  adoptRemoteAuthorityRecord?: (record: DailyRecord) => Promise<DailyRecord>;
  /** Atomically completes only a confirmed local-first full save and returns retained work. */
  completeConfirmedLocalWrite?: (record: DailyRecord) => Promise<DailyRecord | undefined>;
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
  allowOfflineQueue?: boolean;
}): Promise<'continue' | 'return'> => {
  if (remoteAuthorityFirst) {
    if (
      !isFirestoreEnabled() &&
      (!allowOfflineQueue || getFirestoreSyncState().reason !== 'offline')
    ) {
      throw new Error('La autoridad remota no está disponible para esta escritura clínica.');
    }
    let remoteResult: RemoteAuthorityWriteResult | void;
    try {
      try {
        if (!isFirestoreEnabled()) {
          throw Object.assign(new Error('La sincronización está sin conexión.'), {
            code: 'unavailable',
          });
        }
        remoteResult = await remoteWrite();
      } catch (writeError) {
        const rebased = await attemptStaleVersionRebaseRetry<RemoteAuthorityWriteResult>({
          writeError,
          date,
          hooks: { retryRemoteWriteOnStaleVersion, canRebaseStaleVersionConflict },
          readRemoteConfirmedRecord,
        });
        if (!rebased) throw writeError;
        remoteResult = rebased.result;
      }
    } catch (error) {
      const alreadyAppliedRecovery = await recoverAlreadyAppliedRemoteWrite({
        error,
        date,
        changedPaths,
        state: remoteState,
        resolveAlreadyAppliedRemoteRecord,
        adoptAlreadyAppliedRemoteRecord: adoptRemoteAuthorityRecord,
      });
      if (alreadyAppliedRecovery !== 'not_applied') return alreadyAppliedRecovery;

      onRemoteFailure(error);
      if (
        allowOfflineQueue &&
        classifySyncError(error).category === 'network' &&
        queueLocalBeforeRemote
      ) {
        const queued = await queueLocalBeforeRemote();
        if (!queued.accepted) {
          applyLocalPersistenceFailure(
            date,
            changedPaths,
            toRejectedOutboxPersistenceResult(queued),
            remoteState
          );
          return 'return';
        }
        markLocalWriteSucceeded(remoteState);
        await releaseLocalPreOutboxHold?.();
        remoteState.queuedForRetry = true;
        remoteState.consistencyState = 'queued_for_retry';
        remoteState.retryability = 'automatic_retry';
        remoteState.recoveryAction = 'queue_retry';
        remoteState.userSafeMessage =
          'Entrega guardada en este dispositivo, pendiente de sincronización para el paciente y episodio originales.';
        return 'return';
      }
      throw error;
    }
    markRemoteWriteSucceeded(remoteState);

    const authority = await resolveRemoteAuthorityRecord(
      record,
      remoteResult,
      readRemoteConfirmedRecord,
      expectedVersion
    );
    if (authority.kind !== 'confirmed') {
      applyLocalPersistenceFailure(
        date,
        changedPaths,
        unconfirmedRemoteAuthorityStateResult(date, authority),
        remoteState,
        { remoteCommitted: true }
      );
      return 'return';
    }
    const authoritativeRecord = authority.record;
    remoteState.confirmedRecord = authoritativeRecord;

    const persistedLocally = await persistConfirmedRemoteRecordLocally({
      date,
      changedPaths,
      authoritativeRecord,
      remoteState,
      adoptRemoteAuthorityRecord,
    });
    if (!persistedLocally) return 'return';
    return 'continue';
  }

  if (queueLocalBeforeRemote) {
    const outboxResult = await queueLocalBeforeRemote();
    if (!outboxResult.accepted) {
      applyLocalPersistenceFailure(
        date,
        changedPaths,
        toRejectedOutboxPersistenceResult(outboxResult),
        remoteState
      );
      if (outboxResult.mode === 'retained_for_owner') {
        remoteState.observabilityTags.push('sync_queue_write_retained_for_owner');
      }
      return 'return';
    }
    markLocalWriteSucceeded(remoteState);
  } else {
    const localResult = await saveToIndexedDB(record);
    if (!localResult.ok) {
      applyLocalPersistenceFailure(date, changedPaths, localResult, remoteState);
      return 'return';
    }
    markLocalWriteSucceeded(remoteState);
  }

  if (!isFirestoreEnabled()) {
    return 'continue';
  }

  try {
    let remoteResult: RemoteAuthorityWriteResult | void;
    try {
      remoteResult = await runWithOptionalPreOutboxRenewal(
        remoteWrite,
        renewLocalPreOutboxHold,
        renewLocalPreOutboxHoldEveryMs
      );
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
    markRemoteWriteSucceeded(remoteState);
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
        renewLocalPreOutboxHold,
        renewLocalPreOutboxHoldEveryMs
      );
      if (authority.kind !== 'confirmed') {
        await releaseLocalPreOutboxHold?.();
        applyLocalPersistenceFailure(
          date,
          changedPaths,
          unconfirmedRemoteAuthorityStateResult(date, authority),
          remoteState,
          { remoteCommitted: true }
        );
        return 'return';
      }
      const authoritativeRecord = authority.record;
      remoteState.confirmedRecord = authoritativeRecord;
      const persistedLocally = await persistConfirmedRemoteRecordLocally({
        date,
        changedPaths,
        authoritativeRecord,
        remoteState,
        adoptRemoteAuthorityRecord,
        completeConfirmedLocalWrite,
        releaseLocalPreOutboxHold,
      });
      if (!persistedLocally) return 'return';
      if (completeConfirmedLocalWrite) return 'continue';
    }
    await ackLocalAfterRemote?.();
    return 'continue';
  } catch (err) {
    onRemoteFailure(err);
    await releaseLocalPreOutboxHold?.();
    const recovery = await resolveRemoteWriteRecovery(
      date,
      record,
      changedPaths,
      err,
      expectedVersion,
      allowConflictAutoMerge,
      Boolean(queueLocalBeforeRemote)
    );
    if (recovery.status === 'throw') {
      applyRecoveryDecisionToState(
        remoteState,
        recovery.decision,
        recovery.error instanceof Error ? recovery.error : undefined
      );
      return 'return';
    }

    remoteState.queuedForRetry = recovery.queuedForRetry;
    remoteState.autoMerged = recovery.autoMerged;
    applyRecoveryDecisionToState(remoteState, recovery.decision);
    return recovery.status === 'auto_merged' ? 'return' : 'continue';
  }
};
