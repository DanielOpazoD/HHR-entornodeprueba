import { captureAuthoringSession } from '@/services/storage/authoringSession';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { saveDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordSavePersistenceController';
import {
  isDailyRecordWriteRejectedResult,
  resolveDailyRecordWriteStatus,
  toDailyRecordWriteError,
} from '@/services/repositories/contracts/dailyRecordResults';
import { assertRayenCensusPersistenceConfirmed } from '../hooks/rayenCensusPersistenceGuard';

/**
 * Whether a cross-day patch waits in this computer's queue instead of counting as applied: the
 * server did not take it and only this computer keeps it. A refusal that kept nothing throws.
 */
export const isHistoricalPatchOnlyQueued = (
  result: Awaited<ReturnType<typeof patchDailyRecordWithCompatibility>>
): boolean => {
  if (!result) return false;
  const status = resolveDailyRecordWriteStatus(result);
  if (status.state === 'confirmed' || !isDailyRecordWriteRejectedResult(result)) return false;
  // Only proven local persistence can be described as queued after a remote rejection.
  if (status.savedHere) return true;
  throw toDailyRecordWriteError(result, 'No se confirmó el guardado histórico.');
};

/** Movement and matching occupancy repair must reach authority together, without an invalid midpoint. */
export const persistHistoricalOccupancyCorrection = async (
  repository: DailyRecordRepositoryPort,
  base: DailyRecord,
  corrected: DailyRecord
): Promise<void> => {
  const result = await saveDailyRecordWithCompatibility(repository, corrected, base.lastUpdated, {
    authoringSession: captureAuthoringSession(),
    rayenStructuralWriteGuard: true,
    requireConfirmedRecord: true,
  });
  assertRayenCensusPersistenceConfirmed({ record: corrected, result });
  if (
    !result ||
    resolveDailyRecordWriteStatus(result).state !== 'confirmed' ||
    result.confirmedRecord?.date !== base.date
  )
    throw new Error('No se confirmó la conciliación del censo histórico.');
};
