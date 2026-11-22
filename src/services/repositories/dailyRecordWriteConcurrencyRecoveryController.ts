import type { AuthoringSession } from '@/services/session/authoringSession';
import { attemptConflictAutoMergeRecovery } from '@/services/repositories/dailyRecordConflictAutoMergeController';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  pendingWriteOutcome,
  settleWriteResult,
  unrecoverableWriteOutcome,
  type RemoteWriteStep,
} from '@/services/repositories/dailyRecordWriteState';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  FIELD_CHANGED_ELSEWHERE_MESSAGE,
  isFieldChangedElsewhereError,
} from '@/services/storage/syncErrorCatalog';

/** Another writer changed the day first and nothing merged it: a person reviews it. */
const unresolvedConflict = (
  current: DailyRecordWriteResult,
  error: unknown,
  userSafeMessage: string
): RemoteWriteStep => ({
  result: settleWriteResult(current, unrecoverableWriteOutcome(current), {
    userSafeMessage,
    blockingError: error instanceof Error ? error : undefined,
    concurrencyConflict: true,
  }),
  next: 'return',
});

export const resolveConcurrencyRemoteWriteRecovery = async (
  date: string,
  record: DailyRecord,
  changedPaths: string[],
  error: unknown,
  current: DailyRecordWriteResult,
  authoringSession: AuthoringSession,
  allowAutoMerge: boolean = true
): Promise<RemoteWriteStep> => {
  if (!allowAutoMerge) {
    return unresolvedConflict(
      current,
      error,
      'El egreso fue modificado por otro usuario. Recarga el censo antes de reclasificarlo.'
    );
  }

  const fieldChangedElsewhere = isFieldChangedElsewhereError(error);
  const mergeResult = await attemptConflictAutoMergeRecovery(
    date,
    record,
    changedPaths,
    authoringSession,
    fieldChangedElsewhere ? error : undefined
  );
  if (mergeResult.status === 'auto_merged' && fieldChangedElsewhere) {
    // Held as a conflict that keeps this device's text: nothing was integrated, and sending it
    // again would only meet the same refusal.
    return {
      result: settleWriteResult(
        current,
        { state: 'held', reason: 'field_changed_elsewhere' },
        { userSafeMessage: FIELD_CHANGED_ELSEWHERE_MESSAGE, concurrencyConflict: true }
      ),
      next: 'return',
    };
  }
  if (mergeResult.status === 'auto_merged') {
    return {
      result: settleWriteResult(current, pendingWriteOutcome(current, 'merged'), {
        userSafeMessage: 'Se resolvió un conflicto remoto mediante fusión automática.',
        concurrencyConflict: true,
      }),
      next: 'return',
    };
  }

  return unresolvedConflict(
    current,
    error,
    'Se detectó un conflicto remoto que requiere revisión manual.'
  );
};
