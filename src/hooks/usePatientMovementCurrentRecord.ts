import { useCallback, MutableRefObject } from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';

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
