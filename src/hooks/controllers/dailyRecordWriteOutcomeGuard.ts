import type {
  SaveDailyRecordResult,
  UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { isDailyRecordWriteBlockedResult } from '@/services/repositories/contracts/dailyRecordResults';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';

type DailyRecordWriteResult =
  | SaveDailyRecordResult
  | UpdatePartialDailyRecordResult
  | null
  | undefined;

export class DailyRecordWriteBlockedOutcomeError extends Error {
  readonly result: Exclude<DailyRecordWriteResult, null | undefined>;

  constructor(result: Exclude<DailyRecordWriteResult, null | undefined>) {
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

export const assertDailyRecordWriteAccepted = (result: DailyRecordWriteResult): void => {
  if (!result) {
    return;
  }

  if (result.outcome === 'blocked' || isDailyRecordWriteBlockedResult(result)) {
    throw new DailyRecordWriteBlockedOutcomeError(result);
  }
};
