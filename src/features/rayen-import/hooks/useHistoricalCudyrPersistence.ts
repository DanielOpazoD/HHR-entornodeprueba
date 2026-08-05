import { useCallback } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { HistoricalCudyrBatchItem } from '../contracts/clinicalFillContracts';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
import type { DailyRecord } from '../contracts/rayenDomainContracts';

export const useHistoricalCudyrPersistence = ({
  dailyRecord,
  isAdmin,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
}) => {
  const applyHistoricalCudyr = useCallback(
    (
      clinicalEpisodeId: string,
      censusDay: string,
      cudyr: ImportedCudyr,
      writeGuard?: RayenClinicalWriteGuard
    ) =>
      import('./applyHistoricalCudyr').then(({ applyHistoricalCudyr }) =>
        applyHistoricalCudyr({
          dailyRecord,
          clinicalEpisodeId,
          censusDay,
          cudyr,
          isAdmin,
          writeGuard,
        })
      ),
    [dailyRecord, isAdmin]
  );
  const applyHistoricalCudyrBatch = useCallback(
    (censusDay: string, items: HistoricalCudyrBatchItem[], writeGuard?: RayenClinicalWriteGuard) =>
      import('./applyHistoricalCudyr').then(({ applyHistoricalCudyrBatch }) =>
        applyHistoricalCudyrBatch({
          dailyRecord,
          censusDay,
          items,
          isAdmin,
          writeGuard,
        })
      ),
    [dailyRecord, isAdmin]
  );
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

  return { applyHistoricalCudyr, applyHistoricalCudyrBatch, applyHistoricalCudyrEnforcedBatch };
};
