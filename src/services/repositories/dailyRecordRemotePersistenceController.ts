import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  saveRecordStrict as saveToIndexedDB,
  type LocalRecordWriteResult,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
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

const runRemoteWriteWithOptionalPreOutboxRenewal = async <T>(
  remoteWrite: () => Promise<T>,
  renewLocalPreOutboxHold?: () => Promise<void>,
  renewIntervalMs?: number
): Promise<T> => {
  if (!renewLocalPreOutboxHold || !renewIntervalMs || renewIntervalMs <= 0) {
    return remoteWrite();
  }

  const intervalId = globalThis.setInterval(() => {
    renewLocalPreOutboxHold().catch(error =>
      logger.warn('Failed to renew local pre-outbox hold', error)
    );
  }, renewIntervalMs);

  try {
    return await remoteWrite();
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

/**
 * Older deployed authority callables can confirm a write without returning `recordState`.
 * Read the committed document once in that compatibility case so the next clinical stage receives
 * the server version instead of treating a successful census write as an operational failure.
 */
const resolveRemoteAuthorityRecord = async (
  record: DailyRecord,
  result: RemoteAuthorityWriteResult | void,
  readRemoteConfirmedRecord?: () => Promise<DailyRecord | null>
): Promise<DailyRecord | null> => {
  const responseRecord = applyRemoteAuthorityState(record, result);
  if (responseRecord) return responseRecord;
  if (!readRemoteConfirmedRecord) return null;

  try {
    const remoteRecord = await readRemoteConfirmedRecord();
    return isValidRemoteAuthorityRecord(remoteRecord, record.date) ? remoteRecord : null;
  } catch (error) {
    logger.warn('Could not read back the server-confirmed daily record', error);
    return null;
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
  canRebaseStaleVersionConflict?: (freshRemoteRecord: DailyRecord) => boolean;
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
}): Promise<'continue' | 'return'> => {
  if (remoteAuthorityFirst) {
    if (!isFirestoreEnabled()) {
      throw new Error('La autoridad remota no está disponible para esta escritura clínica.');
    }
    let remoteResult: RemoteAuthorityWriteResult | void;
    try {
      remoteResult = await remoteWrite();
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
      throw error;
    }
    markRemoteWriteSucceeded(remoteState);

    const authoritativeRecord = await resolveRemoteAuthorityRecord(
      record,
      remoteResult,
      readRemoteConfirmedRecord
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

    if (adoptRemoteAuthorityRecord) {
      try {
        remoteState.localProjectionRecord = await adoptRemoteAuthorityRecord(authoritativeRecord);
      } catch (error) {
        applyLocalPersistenceFailure(
          date,
          changedPaths,
          {
            ok: false,
            operation: 'save',
            store: 'none',
            dates: [date],
            error,
            userSafeMessage:
              'El cambio quedó confirmado en el servidor, pero la cola local no pudo reconciliarse.',
          },
          remoteState,
          { remoteCommitted: true }
        );
        return 'return';
      }
    } else {
      const localResult = await saveToIndexedDB(authoritativeRecord);
      if (!localResult.ok) {
        applyLocalPersistenceFailure(date, changedPaths, localResult, remoteState, {
          remoteCommitted: true,
        });
        return 'return';
      }
    }
    markLocalWriteSucceeded(remoteState);
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
      remoteResult = await runRemoteWriteWithOptionalPreOutboxRenewal(
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
      const authoritativeRecord = await resolveRemoteAuthorityRecord(
        record,
        remoteResult,
        readRemoteConfirmedRecord
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
      if (adoptRemoteAuthorityRecord) {
        try {
          remoteState.localProjectionRecord =
            await adoptRemoteAuthorityRecord(authoritativeRecord);
        } catch (error) {
          await releaseLocalPreOutboxHold?.();
          applyLocalPersistenceFailure(
            date,
            changedPaths,
            {
              ok: false,
              operation: 'save',
              store: 'none',
              dates: [date],
              error,
              userSafeMessage:
                'El cambio quedó confirmado en el servidor, pero la cola local no pudo reconciliarse.',
            },
            remoteState,
            { remoteCommitted: true }
          );
          return 'return';
        }
      } else {
        const localResult = await saveToIndexedDB(authoritativeRecord);
        if (!localResult.ok) {
          await releaseLocalPreOutboxHold?.();
          applyLocalPersistenceFailure(date, changedPaths, localResult, remoteState, {
            remoteCommitted: true,
          });
          return 'return';
        }
      }
      markLocalWriteSucceeded(remoteState);
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
