import { useCallback } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { HistoricalCudyrBatchItem } from '../contracts/clinicalFillContracts';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
import {
  applyHistoricalCudyr as applyHistoricalCudyrToRecord,
  applyHistoricalCudyrBatch as applyHistoricalCudyrBatchToRecord,
  applyHistoricalCudyrBatchAuthoritatively,
} from './applyHistoricalCudyr';
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
      applyHistoricalCudyrToRecord({
        dailyRecord,
        clinicalEpisodeId,
        censusDay,
        cudyr,
        isAdmin,
        writeGuard,
      }),
    [dailyRecord, isAdmin]
  );
  const applyHistoricalCudyrBatch = useCallback(
    (censusDay: string, items: HistoricalCudyrBatchItem[], writeGuard?: RayenClinicalWriteGuard) =>
      applyHistoricalCudyrBatchToRecord({
        dailyRecord,
        censusDay,
        items,
        isAdmin,
        writeGuard,
      }),
    [dailyRecord, isAdmin]
  );
  const applyHistoricalCudyrEnforcedBatch = useCallback(
    (
      sourceRecord: DailyRecord,
      censusDay: string,
      items: HistoricalCudyrBatchItem[],
      runId: string
    ) =>
      applyHistoricalCudyrBatchAuthoritatively({
        dailyRecord,
        sourceRecord,
        censusDay,
        items,
        isAdmin,
        runId,
      }),
    [dailyRecord, isAdmin]
  );

  return { applyHistoricalCudyr, applyHistoricalCudyrBatch, applyHistoricalCudyrEnforcedBatch };
};
