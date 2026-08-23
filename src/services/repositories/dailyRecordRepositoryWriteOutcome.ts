import type {
  SaveDailyRecordResult,
  UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { isDailyRecordWriteBlockedResult } from '@/services/repositories/contracts/dailyRecordResults';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';

export const assertDailyRecordSaveAccepted = (result: SaveDailyRecordResult): void => {
  if (result.blockingError) throw result.blockingError;
};

export const assertDailyRecordPartialUpdateAccepted = (
  result: UpdatePartialDailyRecordResult
): void => {
  if (result.blockingError) throw result.blockingError;
  if (result.outcome !== 'blocked' && !isDailyRecordWriteBlockedResult(result)) return;
  throw new Error(
    resolveApplicationOutcomeMessage(
      result,
      'La actualización quedó bloqueada por una validación de consistencia.'
    )
  );
};
