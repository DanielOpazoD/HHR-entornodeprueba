import {
  toDailyRecordWriteError,
  type DailyRecordWriteResult,
} from '@/services/repositories/contracts/dailyRecordResults';

/**
 * What `save`/`updatePartial` callers get: the write throws when it was blocked or its producer
 * attached an error. A refusal that kept this computer's copy for review resolves here; the census
 * flow (`assertDailyRecordWriteAccepted`) is the caller that stops on it.
 */
export const assertDailyRecordRepositoryWriteAccepted = (result: DailyRecordWriteResult): void => {
  if (result.blockingError || (result.state === 'not_saved' && result.reason === 'blocked')) {
    throw toDailyRecordWriteError(
      result,
      'La actualización quedó bloqueada por una validación de consistencia.'
    );
  }
};
