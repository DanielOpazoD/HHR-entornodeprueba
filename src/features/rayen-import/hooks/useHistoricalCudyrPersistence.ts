import type { UserRole } from '@/types/authRoleTypes';
import { useCallback } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { HistoricalCudyrBatchItem } from '../contracts/clinicalFillContracts';
import type { DailyRecord } from '../contracts/rayenDomainContracts';

export const useHistoricalCudyrPersistence = ({
  dailyRecord,
  role,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  role: UserRole | null;
}) => {
  const applyHistoricalCudyrEnforcedBatch = useCallback(
    (
      sourceRecord: DailyRecord,
      censusDay: string,
      items: HistoricalCudyrBatchItem[],
      runId: string,
      checkSession?: () => void
    ) =>
      import('./applyHistoricalCudyr').then(({ applyHistoricalCudyrBatchAuthoritatively }) => {
        checkSession?.();
        return applyHistoricalCudyrBatchAuthoritatively({
          checkSession,
          dailyRecord,
          sourceRecord,
          censusDay,
          items,
          role,
          runId,
        });
      }),
    [dailyRecord, role]
  );

  return { applyHistoricalCudyrEnforcedBatch };
};
