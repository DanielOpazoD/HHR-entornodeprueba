import { useCallback, MutableRefObject } from 'react';
import { DailyRecord } from '@/types';
import { usePatientMovementCurrentRecord } from '@/features/census/hooks/usePatientMovementCurrentRecord';

interface UsePatientMovementMutationExecutorParams {
  recordRef: MutableRefObject<DailyRecord | null>;
  saveAndUpdate: (updatedRecord: DailyRecord) => void;
}

export const usePatientMovementMutationExecutor = ({
  recordRef,
  saveAndUpdate,
}: UsePatientMovementMutationExecutorParams) => {
  const withCurrentRecord = usePatientMovementCurrentRecord({ recordRef });

  return useCallback(
    (mutation: (record: DailyRecord) => DailyRecord) => {
      withCurrentRecord(record => {
        saveAndUpdate(mutation(record));
      });
    },
    [saveAndUpdate, withCurrentRecord]
  );
};
