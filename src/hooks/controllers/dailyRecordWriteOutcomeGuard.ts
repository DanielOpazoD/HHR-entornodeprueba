import {
  isDailyRecordWriteRejectedResult,
  type DailyRecordWriteResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';

export class DailyRecordWriteBlockedOutcomeError extends Error {
  readonly result: DailyRecordWriteResult;

  constructor(result: DailyRecordWriteResult) {
    super(
      resolveApplicationOutcomeMessage(
        result,
        'La operación quedó bloqueada por una validación de consistencia.'
      )
    );
    this.name = 'DailyRecordWriteBlockedOutcomeError';
    this.result = result;
  }
}

export const assertDailyRecordWriteAccepted = (
  result: DailyRecordWriteResult | null | undefined
): void => {
  if (!result) {
    return;
  }

  if (isDailyRecordWriteRejectedResult(result)) {
    throw new DailyRecordWriteBlockedOutcomeError(result);
  }
};
