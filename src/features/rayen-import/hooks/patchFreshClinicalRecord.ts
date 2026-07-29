import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ClinicalFillPatchTarget } from '../contracts/clinicalFillContracts';
import { assertClinicalFillPatchTarget } from '../domain/clinicalFillPatchTarget';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';

const isConcurrencyFailure = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConcurrencyError';

const writeFreshClinicalPatch = async (
  dailyRecord: DailyRecordRepositoryPort,
  patch: DailyRecordPatch,
  target: ClinicalFillPatchTarget
): Promise<void> => {
  const fresh = await dailyRecord.getForDateWithMeta(target.censusDate, true);
  if (!fresh.record) throw new Error('No se pudo obtener la versión vigente del censo.');
  assertClinicalFillPatchTarget(fresh.record, target);
  const result = await patchDailyRecordWithCompatibility(dailyRecord, target.censusDate, patch, {
    baseRecord: fresh.record,
    historyPolicy: target.captureHistorySnapshot === false ? 'skip' : 'snapshot',
  });
  if (isDailyRecordWriteRejectedResult(result)) {
    const rejection = new Error(result?.userSafeMessage || 'El guardado clínico fue bloqueado.');
    if (result?.conflictSummary?.kind === 'concurrency') rejection.name = 'ConcurrencyError';
    throw result?.conflictSummary?.kind === 'concurrency'
      ? rejection
      : (result?.blockingError ?? rejection);
  }
  if (result?.blockingError) throw result.blockingError;
};

/** Writes one enrichment patch against freshly hydrated census truth. */
export const patchFreshClinicalRecord = async (
  dailyRecord: DailyRecordRepositoryPort,
  patch: DailyRecordPatch,
  target: ClinicalFillPatchTarget
): Promise<void> => {
  try {
    await writeFreshClinicalPatch(dailyRecord, patch, target);
  } catch (error) {
    if (!isConcurrencyFailure(error)) throw error;
    // The bounded retry is safe: it rehydrates and revalidates the episode/bed target before
    // reapplying the same granular clinical patch, without replacing unrelated census fields.
    await writeFreshClinicalPatch(dailyRecord, patch, target);
  }
};
