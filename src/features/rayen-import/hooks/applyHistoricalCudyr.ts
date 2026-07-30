import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { HistoricalCudyrApplyResult } from '../clinicalFillRunner';
import { resolveHistoricalCudyrPatch } from '../domain/historicalCudyrPatch';
import { canWritePreviousDay } from '../domain/previousDayCorrections';

const concurrencyError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'ConcurrencyError';
  return error;
};

const isConcurrencyFailure = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConcurrencyError';

const writeHistoricalCudyr = async ({
  dailyRecord,
  clinicalEpisodeId,
  censusDay,
  cudyr,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  clinicalEpisodeId: string;
  censusDay: string;
  cudyr: ImportedCudyr;
}): Promise<HistoricalCudyrApplyResult> => {
  const historicalRecord = (await dailyRecord.getForDateWithMeta(censusDay, true)).record;
  if (!historicalRecord) return { persisted: false, changed: false, applicable: false };

  const resolution = resolveHistoricalCudyrPatch(historicalRecord, clinicalEpisodeId, cudyr);
  if (!resolution.matched) return { persisted: false, changed: false, applicable: false };
  if (!resolution.patch) return { persisted: true, changed: false };

  const result = await patchDailyRecordWithCompatibility(dailyRecord, censusDay, resolution.patch, {
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
  return { persisted: true, changed: true };
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
  if (!canWritePreviousDay(censusDay, isAdmin)) return { persisted: false, changed: false };
  const input = { dailyRecord, clinicalEpisodeId, censusDay, cudyr };
  try {
    return await writeHistoricalCudyr(input);
  } catch (error) {
    if (!isConcurrencyFailure(error)) throw error;
    // One bounded retry rehydrates the latest revision and recomputes the granular CUDYR patch.
    return writeHistoricalCudyr(input);
  }
};
