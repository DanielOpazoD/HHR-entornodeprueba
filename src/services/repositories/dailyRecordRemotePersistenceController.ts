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
      : 'La cola de sincronización no pudo confirmar la persistencia local.'
  ),
  userSafeMessage:
    result.mode === 'rejected_backpressure'
      ? 'La cola de sincronización alcanzó su límite operativo. Revisa conectividad o libera tareas pendientes antes de reintentar.'
      : 'No fue posible guardar el registro local junto a su tarea de sincronización.',
});

const applyRemoteRecovery = async (
  date: string,
  record: DailyRecord,
  fields: string[],
  error: unknown,
  state: RemoteWriteState,
  expectedVersion?: string,
  allowConflictAutoMerge: boolean = true
): Promise<'continue' | 'return'> => {
  const recovery = await resolveRemoteWriteRecovery(
    date,
    record,
    fields,
    error,
    expectedVersion,
    allowConflictAutoMerge
  );
  if (recovery.status === 'throw') {
    applyRecoveryDecisionToState(
      state,
      recovery.decision,
      recovery.error instanceof Error ? recovery.error : undefined
    );
    return 'return';
  }

  state.queuedForRetry = recovery.queuedForRetry;
  state.autoMerged = recovery.autoMerged;
  applyRecoveryDecisionToState(state, recovery.decision);
  return recovery.status === 'auto_merged' ? 'return' : 'continue';
};

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
): Promise<DailyRecord | null> => {
  const responseRecord = applyRemoteAuthorityState(record, result);
  if (responseRecord) return responseRecord;
  if (!readRemoteConfirmedRecord) return null;

  for (let attempt = 0; ; attempt += 1) {
    let remoteRecord: DailyRecord | null;
    try {
      remoteRecord = await readRemoteConfirmedRecord();
    } catch (error) {
      logger.warn('Could not read back the server-confirmed daily record', error);
      return null;
    }
    if (!isValidRemoteAuthorityRecord(remoteRecord, record.date)) return null;
    if (!isSameVersion(remoteRecord.lastUpdated, expectedVersion)) return remoteRecord;

    const delayMs = PRE_COMMIT_READBACK_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined) {
      logger.warn('The server readback still shows the pre-write daily record', {
        date: record.date,
      });
      return null;
    }
    await wait(delayMs);
  }
};

const missingRemoteAuthorityStateResult = (date: string): LocalRecordWriteResult => ({
  ok: false,
  operation: 'save',
  store: 'none',
  dates: [date],
  error: new Error('La autoridad remota no devolvió la versión confirmada del registro.'),
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

    const authoritativeRecord = await resolveRemoteAuthorityRecord(
      record,
      remoteResult,
      readRemoteConfirmedRecord,
      expectedVersion
    );
    if (!authoritativeRecord) {
      applyLocalPersistenceFailure(
        date,
        changedPaths,
        missingRemoteAuthorityStateResult(date),
        remoteState,
        { remoteCommitted: true }
      );
      return 'return';
    }
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
      const authoritativeRecord = await runWithOptionalPreOutboxRenewal(
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
      if (!authoritativeRecord) {
        await releaseLocalPreOutboxHold?.();
        applyLocalPersistenceFailure(
          date,
          changedPaths,
          missingRemoteAuthorityStateResult(date),
          remoteState,
          { remoteCommitted: true }
        );
        return 'return';
      }
      remoteState.confirmedRecord = authoritativeRecord;
      const persistedLocally = await persistConfirmedRemoteRecordLocally({
        date,
        changedPaths,
        authoritativeRecord,
        remoteState,
        adoptRemoteAuthorityRecord,
        releaseLocalPreOutboxHold,
      });
      if (!persistedLocally) return 'return';
    }
    await ackLocalAfterRemote?.();
    return 'continue';
  } catch (err) {
    onRemoteFailure(err);
    await releaseLocalPreOutboxHold?.();
    return applyRemoteRecovery(
      date,
      record,
      changedPaths,
      err,
      remoteState,
      expectedVersion,
      allowConflictAutoMerge
    );
  }
};
