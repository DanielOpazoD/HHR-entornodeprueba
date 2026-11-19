import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import { logger } from '@/services/utils/loggerService';
import {
  settleWriteResult,
  type RemoteWriteStep,
} from '@/services/repositories/dailyRecordWriteState';

const LOCAL_COPY_STALE_MESSAGE =
  'Los cambios ya quedaron guardados en el servidor, pero no se pudo actualizar la copia local. Recarga la página antes de continuar.';

/** The caller's own error when it is one; otherwise an error that says what failed. */
export const toWriteError = (error: unknown, message: string): Error =>
  error instanceof Error ? error : new Error(message);

/** The server took the write. */
export const confirmedByServer = (current: DailyRecordWriteResult): DailyRecordWriteResult =>
  settleWriteResult(current, { state: 'confirmed', localCopy: 'current' });

/** This computer stored the write. */
export const storedHere = (current: DailyRecordWriteResult): DailyRecordWriteResult => ({
  ...current,
  savedHere: true,
});

/** The server took the write, but this computer's copy could not follow it. */
export const localCopyStale = (
  current: DailyRecordWriteResult,
  blockingError: Error
): DailyRecordWriteResult =>
  settleWriteResult(
    { ...current, savedHere: false },
    { state: 'confirmed', localCopy: 'stale' },
    { userSafeMessage: LOCAL_COPY_STALE_MESSAGE, blockingError }
  );

/** Neither this computer nor the server stored the write. */
export const notStored = (
  current: DailyRecordWriteResult,
  blockingError: Error,
  userSafeMessage: string,
  reason: 'local_failed' | 'session_changed' = 'local_failed'
): DailyRecordWriteResult =>
  settleWriteResult(current, { state: 'not_saved', reason }, { userSafeMessage, blockingError });

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

/**
 * A guarded write that lost its race can still be the one the server holds. `null`: not proven,
 * the caller treats the write as failed.
 */
export const recoverAlreadyAppliedRemoteWrite = async ({
  error,
  date,
  current,
  resolveAlreadyAppliedRemoteRecord,
  adoptAlreadyAppliedRemoteRecord,
}: {
  error: unknown;
  date: string;
  current: DailyRecordWriteResult;
  resolveAlreadyAppliedRemoteRecord?: (error: unknown) => Promise<DailyRecord | null>;
  adoptAlreadyAppliedRemoteRecord?: (record: DailyRecord) => Promise<DailyRecord>;
}): Promise<RemoteWriteStep | null> => {
  if (!resolveAlreadyAppliedRemoteRecord) return null;

  let alreadyAppliedRecord: DailyRecord | null = null;
  try {
    const candidate = await resolveAlreadyAppliedRemoteRecord(error);
    alreadyAppliedRecord = isValidRemoteAuthorityRecord(candidate, date) ? candidate : null;
  } catch (resolutionError) {
    logger.warn('Could not verify whether the guarded write was already applied', resolutionError);
  }
  if (!alreadyAppliedRecord) return null;
  if (!adoptAlreadyAppliedRemoteRecord) {
    logger.warn('Already-applied guarded write has no safe local adoption callback');
    return null;
  }

  const confirmed = { ...confirmedByServer(current), confirmedRecord: alreadyAppliedRecord };
  let localProjectionRecord: DailyRecord;
  try {
    localProjectionRecord = await adoptAlreadyAppliedRemoteRecord(alreadyAppliedRecord);
  } catch (adoptionError) {
    const blockingError = toWriteError(
      adoptionError,
      'El cambio quedó confirmado en el servidor, pero la cola local cambió antes de poder reconciliarse.'
    );
    return { result: localCopyStale(confirmed, blockingError), next: 'return' };
  }
  return { result: storedHere({ ...confirmed, localProjectionRecord }), next: 'continue' };
};
