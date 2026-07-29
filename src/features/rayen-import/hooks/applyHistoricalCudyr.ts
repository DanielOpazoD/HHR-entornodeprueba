import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { HistoricalCudyrApplyResult } from '../clinicalFillRunner';
import { resolveHistoricalCudyrPatch } from '../domain/historicalCudyrPatch';
import { canWritePreviousDay } from '../domain/previousDayCorrections';

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
  const historicalRecord = await dailyRecord.getForDate(censusDay);
  if (!historicalRecord) return { persisted: false, changed: false, applicable: false };

  const resolution = resolveHistoricalCudyrPatch(historicalRecord, clinicalEpisodeId, cudyr);
  if (!resolution.matched) return { persisted: false, changed: false, applicable: false };
  if (!resolution.patch) return { persisted: true, changed: false };

  const result = await patchDailyRecordWithCompatibility(dailyRecord, censusDay, resolution.patch, {
    baseRecord: historicalRecord,
  });
  if (result?.blockingError) throw result.blockingError;
  if (isDailyRecordWriteRejectedResult(result)) {
    throw new Error(result?.userSafeMessage || 'El guardado histórico del CUDYR fue bloqueado.');
  }
  return { persisted: true, changed: true };
};
