import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import {
  patchDailyRecordWithCompatibility,
  saveDailyRecordWithCompatibility,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import { assertRayenCensusPersistenceConfirmed } from '../hooks/rayenCensusPersistenceGuard';

export type HistoricalPatchOutcome = 'confirmed' | 'durably_queued';

export const classifyHistoricalPatchOutcome = (
  result: Awaited<ReturnType<typeof patchDailyRecordWithCompatibility>>
): HistoricalPatchOutcome => {
  if (!result || result.updatedRemotely || !isDailyRecordWriteRejectedResult(result))
    return 'confirmed';
  // Only proven local persistence can be described as queued after a remote rejection.
  if (result.savedLocally) return 'durably_queued';
  const error =
    result.blockingError ??
    new Error(result.userSafeMessage || 'No se confirmó el guardado histórico.');
  if (result.conflictSummary?.kind === 'concurrency') error.name = 'ConcurrencyError';
  throw error;
};

/** Movement and matching occupancy repair must reach authority together, without an invalid midpoint. */
export const persistHistoricalOccupancyCorrection = async (
  repository: DailyRecordRepositoryPort,
  base: DailyRecord,
  corrected: DailyRecord
): Promise<void> => {
  const result = await saveDailyRecordWithCompatibility(repository, corrected, base.lastUpdated, {
    rayenStructuralWriteGuard: true,
    requireConfirmedRecord: true,
  });
  assertRayenCensusPersistenceConfirmed({ record: corrected, result });
  if (!result?.savedRemotely || result.confirmedRecord?.date !== base.date)
    throw new Error('No se confirmó la conciliación del censo histórico.');
};
