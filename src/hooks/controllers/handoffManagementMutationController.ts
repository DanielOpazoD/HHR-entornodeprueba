import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { presentHandoffManagementFailure } from '@/hooks/controllers/handoffManagementOutcomeController';

interface HandoffMutationFailureOptions {
  fallbackMessage: string;
  fallbackTitle: string;
  reasonTitles?: Partial<Record<string, string>>;
}

interface RunHandoffMutationInput<TData> {
  execute: (record: DailyRecord | null) => Promise<ApplicationOutcome<TData | null>>;
  getCurrentRecord: () => DailyRecord | null;
  notifyError: (title: string, message: string) => void;
  failureOptions: HandoffMutationFailureOptions;
  onSuccess?: (context: {
    currentRecord: DailyRecord;
    data: TData;
    outcome: ApplicationOutcome<TData | null>;
  }) => void | Promise<void>;
}

export interface HandoffMutationRunResult<TData> {
  outcome: ApplicationOutcome<TData | null>;
  currentRecord: DailyRecord | null;
  data: TData | null;
  status: 'success' | 'aborted';
}

export const shouldNotifyHandoffMutationFailure = <TData>(
  outcome: ApplicationOutcome<TData | null>
): boolean => outcome.reason !== 'missing_record';

// Handoff persistence actions share the same control flow: snapshot the active record,
// execute the use-case, ignore missing-record races, surface user-safe failures, then audit.
export const runHandoffMutation = async <TData>({
  execute,
  getCurrentRecord,
  notifyError,
  failureOptions,
  onSuccess,
}: RunHandoffMutationInput<TData>): Promise<HandoffMutationRunResult<TData>> => {
  const currentRecord = getCurrentRecord();
  const outcome = await execute(currentRecord);
  const data = outcome.data;

  if (outcome.status === 'failed' || !currentRecord || !data) {
    if (shouldNotifyHandoffMutationFailure(outcome)) {
      const notice = presentHandoffManagementFailure(outcome, failureOptions);
      notifyError(notice.title, notice.message);
    }

    return {
      outcome,
      currentRecord,
      data,
      status: 'aborted',
    };
  }

  await onSuccess?.({ currentRecord, data, outcome });

  return {
    outcome,
    currentRecord,
    data,
    status: 'success',
  };
};
