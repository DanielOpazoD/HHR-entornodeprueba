import { useCallback, MutableRefObject } from 'react';
import { DailyRecord } from '@/types';

interface UsePatientMovementCurrentRecordParams {
  recordRef: MutableRefObject<DailyRecord | null>;
}

export const usePatientMovementCurrentRecord = ({
  recordRef,
}: UsePatientMovementCurrentRecordParams) => {
  return useCallback(
    <T>(operation: (record: DailyRecord) => T): T | undefined => {
      const currentRecord = recordRef.current;
      if (!currentRecord) {
        return undefined;
      }
      return operation(currentRecord);
    },
    [recordRef]
  );
};
