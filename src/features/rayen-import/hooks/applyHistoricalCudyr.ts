import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type {
  HistoricalCudyrApplyResult,
  HistoricalCudyrBatchItem,
  HistoricalCudyrBatchItemResult,
} from '../contracts/clinicalFillContracts';
import { resolveHistoricalCudyrPatch } from '../domain/historicalCudyrPatch';
import { canWritePreviousDay } from '../domain/previousDayCorrections';

const concurrencyError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'ConcurrencyError';
  return error;
};

const isConcurrencyFailure = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConcurrencyError';

const writeHistoricalCudyrBatch = async ({
  dailyRecord,
  censusDay,
  items,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  censusDay: string;
  items: HistoricalCudyrBatchItem[];
}): Promise<HistoricalCudyrBatchItemResult[]> => {
  const historicalRecord = (await dailyRecord.getForDateWithMeta(censusDay, true)).record;
  if (!historicalRecord) {
    return items.map(({ clinicalEpisodeId }) => ({
      clinicalEpisodeId,
      persisted: false,
      changed: false,
      applicable: false,
    }));
  }

  const resolutions = items.map(({ clinicalEpisodeId, cudyr }) => ({
    clinicalEpisodeId,
    resolution: resolveHistoricalCudyrPatch(historicalRecord, clinicalEpisodeId, cudyr),
  }));
  const patch = Object.assign(
    {},
    ...resolutions.flatMap(({ resolution }) => (resolution.patch ? [resolution.patch] : []))
  );
  if (Object.keys(patch).length === 0) {
    return resolutions.map(({ clinicalEpisodeId, resolution }) => ({
      clinicalEpisodeId,
      persisted: resolution.matched,
      changed: false,
      ...(!resolution.matched ? { applicable: false as const } : {}),
    }));
  }

  const result = await patchDailyRecordWithCompatibility(dailyRecord, censusDay, patch, {
    baseRecord: historicalRecord,
  });
  if (isDailyRecordWriteRejectedResult(result)) {
    if (result?.conflictSummary?.kind === 'concurrency') {
      throw concurrencyError(result.userSafeMessage || 'El censo cambió durante el guardado.');
    }
    if (result?.blockingError) throw result.blockingError;
    throw new Error(result?.userSafeMessage || 'El guardado histórico del CUDYR fue bloqueado.');
  }
  if (result?.blockingError) throw result.blockingError;
  return resolutions.map(({ clinicalEpisodeId, resolution }) => ({
    clinicalEpisodeId,
    persisted: resolution.matched,
    changed: Boolean(resolution.patch),
    ...(!resolution.matched ? { applicable: false as const } : {}),
  }));
};

const uniqueBatchItems = (items: HistoricalCudyrBatchItem[]): HistoricalCudyrBatchItem[] => [
  ...new Map(items.map(item => [item.clinicalEpisodeId, item])).values(),
];

export const applyHistoricalCudyrBatch = async ({
  dailyRecord,
  censusDay,
  items,
  isAdmin,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  censusDay: string;
  items: HistoricalCudyrBatchItem[];
  isAdmin: boolean;
}): Promise<HistoricalCudyrBatchItemResult[]> => {
  const uniqueItems = uniqueBatchItems(items);
  if (uniqueItems.length === 0) return [];
  if (!canWritePreviousDay(censusDay, isAdmin)) {
    return uniqueItems.map(({ clinicalEpisodeId }) => ({
      clinicalEpisodeId,
      persisted: false,
      changed: false,
    }));
  }
  const input = { dailyRecord, censusDay, items: uniqueItems };
  try {
    return await writeHistoricalCudyrBatch(input);
  } catch (error) {
    if (!isConcurrencyFailure(error)) throw error;
    // One bounded retry rehydrates the latest revision and recomputes the whole granular batch.
    return writeHistoricalCudyrBatch(input);
  }
};

export const applyHistoricalCudyr = async ({
  dailyRecord,
  clinicalEpisodeId,
  censusDay,
  cudyr,
  isAdmin,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  clinicalEpisodeId: string;
  censusDay: string;
  cudyr: ImportedCudyr;
  isAdmin: boolean;
}): Promise<HistoricalCudyrApplyResult> => {
  const [result] = await applyHistoricalCudyrBatch({
    dailyRecord,
    censusDay,
    items: [{ clinicalEpisodeId, cudyr }],
    isAdmin,
  });
  if (!result) return { persisted: false, changed: false, applicable: false };
  const { clinicalEpisodeId: _clinicalEpisodeId, ...singleResult } = result;
  return singleResult;
};
