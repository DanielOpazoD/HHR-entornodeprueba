import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { LocalRecordWriteResult } from '@/services/storage/indexeddb/indexedDbRecordService';
import { logger } from '@/services/utils/loggerService';
import {
  applyRecoveryDecisionToState,
  type RemoteWriteState,
} from '@/services/repositories/dailyRecordWriteState';

export const markRemoteWriteSucceeded = (state: RemoteWriteState): void => {
  state.savedRemotely = true;
  state.consistencyState = 'persisted_and_synced';
  state.recoveryAction = 'none';
  state.retryability = 'not_applicable';
  state.observabilityTags = ['daily_record', 'write', 'persisted_and_synced'];
};

export const markLocalWriteSucceeded = (state: RemoteWriteState): void => {
  state.savedLocally = true;
};

const toLocalPersistenceError = (result: LocalRecordWriteResult): Error =>
  result.error instanceof Error
    ? result.error
    : new Error(result.userSafeMessage || 'No fue posible guardar el registro local.');

export const applyLocalPersistenceFailure = (
  date: string,
  changedPaths: string[],
  result: LocalRecordWriteResult,
  state: RemoteWriteState,
  { remoteCommitted = false }: { remoteCommitted?: boolean } = {}
): void => {
  const error = toLocalPersistenceError(result);
  if (remoteCommitted) state.savedLocally = false;
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

export const isValidRemoteAuthorityRecord = (
  candidate: DailyRecord | null | undefined,
  expectedDate: string
): candidate is DailyRecord =>
  Boolean(
    candidate &&
    candidate.date === expectedDate &&
    typeof candidate.lastUpdated === 'string' &&
    candidate.lastUpdated
  );

export const recoverAlreadyAppliedRemoteWrite = async ({
  error,
  date,
  changedPaths,
  state,
  resolveAlreadyAppliedRemoteRecord,
  adoptAlreadyAppliedRemoteRecord,
}: {
  error: unknown;
  date: string;
  changedPaths: string[];
  state: RemoteWriteState;
  resolveAlreadyAppliedRemoteRecord?: (error: unknown) => Promise<DailyRecord | null>;
  adoptAlreadyAppliedRemoteRecord?: (record: DailyRecord) => Promise<DailyRecord>;
}): Promise<'not_applied' | 'continue' | 'return'> => {
  if (!resolveAlreadyAppliedRemoteRecord) return 'not_applied';

  let alreadyAppliedRecord: DailyRecord | null = null;
  try {
    const candidate = await resolveAlreadyAppliedRemoteRecord(error);
    alreadyAppliedRecord = isValidRemoteAuthorityRecord(candidate, date) ? candidate : null;
  } catch (resolutionError) {
    logger.warn('Could not verify whether the guarded write was already applied', resolutionError);
  }
  if (!alreadyAppliedRecord) return 'not_applied';
  if (!adoptAlreadyAppliedRemoteRecord) {
    logger.warn('Already-applied guarded write has no safe local adoption callback');
    return 'not_applied';
  }

  markRemoteWriteSucceeded(state);
  state.observabilityTags = ['daily_record', 'write', 'persisted_and_synced', 'already_applied'];
  state.confirmedRecord = alreadyAppliedRecord;
  try {
    state.localProjectionRecord = await adoptAlreadyAppliedRemoteRecord(alreadyAppliedRecord);
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
          'El cambio quedó confirmado en el servidor, pero la cola local cambió antes de poder reconciliarse.',
      },
      state,
      {
        remoteCommitted: true,
      }
    );
    return 'return';
  }
  markLocalWriteSucceeded(state);
  return 'continue';
};
