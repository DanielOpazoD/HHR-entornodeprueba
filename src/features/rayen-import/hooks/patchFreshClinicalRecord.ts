import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ClinicalFillPatchTarget } from '../contracts/clinicalFillContracts';
import { assertClinicalFillPatchTarget } from '../domain/clinicalFillPatchTarget';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { isDailyRecordWriteBlockedResult } from '@/services/repositories/contracts/dailyRecordResults';

/** Writes one enrichment patch against freshly hydrated census truth. */
export const patchFreshClinicalRecord = async (
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
  if (result?.blockingError) throw result.blockingError;
  if (isDailyRecordWriteBlockedResult(result)) {
    throw new Error(result?.userSafeMessage || 'El guardado clínico fue bloqueado.');
  }
};
