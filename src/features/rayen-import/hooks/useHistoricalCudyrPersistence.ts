import { useCallback } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { HistoricalCudyrBatchItem } from '../contracts/clinicalFillContracts';
import type { DailyRecord } from '../contracts/rayenDomainContracts';

export const useHistoricalCudyrPersistence = ({
  dailyRecord,
  isAdmin,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
}) => {
  const applyHistoricalCudyrEnforcedBatch = useCallback(
    (
      sourceRecord: DailyRecord,
      censusDay: string,
      items: HistoricalCudyrBatchItem[],
      runId: string
    ) =>
      import('./applyHistoricalCudyr').then(({ applyHistoricalCudyrBatchAuthoritatively }) =>
        applyHistoricalCudyrBatchAuthoritatively({
          dailyRecord,
          sourceRecord,
          censusDay,
          items,
          isAdmin,
          runId,
        })
      ),
    [dailyRecord, isAdmin]
  );

  return { applyHistoricalCudyrEnforcedBatch };
};
