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

export interface RemoteAuthorityWriteResult {
  recordState?: {
    lastUpdated: string;
    meta: Record<string, unknown>;
    record: DailyRecord;
  };
}

const markRemoteWriteSucceeded = (state: RemoteWriteState): void => {
  state.savedRemotely = true;
  state.consistencyState = 'persisted_and_synced';
  state.recoveryAction = 'none';
  state.retryability = 'not_applicable';
  state.observabilityTags = ['daily_record', 'write', 'persisted_and_synced'];
};

const markLocalWriteSucceeded = (state: RemoteWriteState): void => {
  state.savedLocally = true;
};

const toLocalPersistenceError = (result: LocalRecordWriteResult): Error => {
  if (result.error instanceof Error) {
    return result.error;
  }

  return new Error(result.userSafeMessage || 'No fue posible guardar el registro local.');
};

const applyLocalPersistenceFailure = (
  date: string,
  changedPaths: string[],
  result: LocalRecordWriteResult,
  state: RemoteWriteState,
  { remoteCommitted = false }: { remoteCommitted?: boolean } = {}
): void => {
  const error = toLocalPersistenceError(result);
  if (remoteCommitted) {
    state.savedLocally = false;
  }
  const userSafeMessage = remoteCommitted
    ? 'Los cambios ya quedaron guardados en el servidor, pero no se pudo actualizar la copia local. Recarga la página antes de continuar.'
    : result.userSafeMessage || 'No fue posible guardar el registro local.';
  applyRecoveryDecisionToState(
    state,
    {
      consistencyState: 'unrecoverable',
      retryability: 'manual_review',
      recoveryAction: 'block_and_surface',
      conflictSummary: {
        kind: 'local_persistence_failed',
        sourceOfTruth: remoteCommitted ? 'remote' : 'none',
        changedPaths,
        message: userSafeMessage,
      },
      observabilityTags: remoteCommitted
        ? ['daily_record', 'write', 'remote_committed', 'local_cache_stale']
        : ['daily_record', 'write', 'local_persistence_failed'],
      userSafeMessage,
    },
    error
  );
};

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
  ackLocalAfterRemote?: () => Promise<void>;
  releaseLocalPreOutboxHold?: () => Promise<void>;
  renewLocalPreOutboxHold?: () => Promise<void>;
  renewLocalPreOutboxHoldEveryMs?: number;
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
      onRemoteFailure(error);
      throw error;
    }
    markRemoteWriteSucceeded(remoteState);

    const authoritativeRecord = applyRemoteAuthorityState(record, remoteResult);
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

    const localResult = await saveToIndexedDB(authoritativeRecord);
    if (!localResult.ok) {
      applyLocalPersistenceFailure(date, changedPaths, localResult, remoteState, {
        remoteCommitted: true,
      });
      return 'return';
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
    const remoteResult = await runRemoteWriteWithOptionalPreOutboxRenewal(
      remoteWrite,
      renewLocalPreOutboxHold,
      renewLocalPreOutboxHoldEveryMs
    );
    markRemoteWriteSucceeded(remoteState);
    if (remoteResult !== undefined) {
      const authoritativeRecord = applyRemoteAuthorityState(record, remoteResult);
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
      const localResult = await saveToIndexedDB(authoritativeRecord);
      if (!localResult.ok) {
        await releaseLocalPreOutboxHold?.();
        applyLocalPersistenceFailure(date, changedPaths, localResult, remoteState, {
          remoteCommitted: true,
        });
        return 'return';
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
