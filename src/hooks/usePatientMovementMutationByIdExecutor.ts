import { useCallback } from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';

interface UsePatientMovementMutationByIdExecutorParams {
  executeMovementMutation: (mutation: (record: DailyRecord) => DailyRecord) => Promise<void>;
}

export const usePatientMovementMutationByIdExecutor = ({
  executeMovementMutation,
}: UsePatientMovementMutationByIdExecutorParams) => {
  return useCallback(
    (mutation: (record: DailyRecord, id: string) => DailyRecord, id: string): Promise<void> =>
      executeMovementMutation(record => mutation(record, id)),
    [executeMovementMutation]
  );
};
