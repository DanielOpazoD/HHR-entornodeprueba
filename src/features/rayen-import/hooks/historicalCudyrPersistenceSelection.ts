import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { HistoricalCudyrApplyResult } from '../clinicalFillRunner';
import type {
  HistoricalCudyrBatchExecutionResult,
  HistoricalCudyrBatchItem,
  HistoricalCudyrBatchItemResult,
} from '../contracts/clinicalFillContracts';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';

export interface HistoricalCudyrWriters {
  applyHistoricalCudyr: (
    encId: string,
    censusDay: string,
    cudyr: ImportedCudyr,
    writeGuard?: RayenClinicalWriteGuard
  ) => Promise<HistoricalCudyrApplyResult>;
  applyHistoricalCudyrBatch?: (
    censusDay: string,
    items: HistoricalCudyrBatchItem[],
    writeGuard?: RayenClinicalWriteGuard
  ) => Promise<HistoricalCudyrBatchItemResult[]>;
  applyHistoricalCudyrEnforcedBatch?: (
    sourceRecord: DailyRecord,
    censusDay: string,
    items: HistoricalCudyrBatchItem[],
    runId: string
  ) => Promise<HistoricalCudyrBatchExecutionResult>;
}

/** Picks the historical CUDYR writer for one run: legacy per-item/batch or the enforced batch. */
export const selectHistoricalCudyrPersistence = (
  writers: HistoricalCudyrWriters,
  historicalWriteGuard: RayenClinicalWriteGuard | undefined,
  sourceRecord: DailyRecord,
  runId: string
) =>
  historicalWriteGuard
    ? {
        applyHistoricalCudyr: (encId: string, censusDay: string, cudyr: ImportedCudyr) =>
          writers.applyHistoricalCudyr(encId, censusDay, cudyr, historicalWriteGuard),
        applyHistoricalCudyrBatch: writers.applyHistoricalCudyrBatch
          ? (censusDay: string, items: HistoricalCudyrBatchItem[]) =>
              writers.applyHistoricalCudyrBatch!(censusDay, items, historicalWriteGuard)
          : undefined,
      }
    : {
        applyHistoricalCudyrBatch: (censusDay: string, items: HistoricalCudyrBatchItem[]) => {
          if (!writers.applyHistoricalCudyrEnforcedBatch) {
            throw new Error('El lote histórico autoritativo no está disponible.');
          }
          return writers.applyHistoricalCudyrEnforcedBatch(sourceRecord, censusDay, items, runId);
        },
      };
