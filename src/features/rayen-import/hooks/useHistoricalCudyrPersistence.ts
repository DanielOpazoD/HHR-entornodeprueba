import { useCallback } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { HistoricalCudyrBatchItem } from '../contracts/clinicalFillContracts';
import {
  applyHistoricalCudyr as applyHistoricalCudyrToRecord,
  applyHistoricalCudyrBatch as applyHistoricalCudyrBatchToRecord,
} from './applyHistoricalCudyr';

export const useHistoricalCudyrPersistence = ({
  dailyRecord,
  isAdmin,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
}) => {
  const applyHistoricalCudyr = useCallback(
    (clinicalEpisodeId: string, censusDay: string, cudyr: ImportedCudyr) =>
      applyHistoricalCudyrToRecord({
        dailyRecord,
        clinicalEpisodeId,
        censusDay,
        cudyr,
        isAdmin,
      }),
    [dailyRecord, isAdmin]
  );
  const applyHistoricalCudyrBatch = useCallback(
    (censusDay: string, items: HistoricalCudyrBatchItem[]) =>
      applyHistoricalCudyrBatchToRecord({ dailyRecord, censusDay, items, isAdmin }),
    [dailyRecord, isAdmin]
  );

  return { applyHistoricalCudyr, applyHistoricalCudyrBatch };
};
