import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ClinicalFillPatchTarget } from '../contracts/clinicalFillContracts';
import { assertClinicalFillPatchTarget } from '../domain/clinicalFillPatchTarget';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { rebuildClinicalEnrichmentOperations } from '../domain/rebuildClinicalEnrichmentOperations';
import { readClinicalFillDerivedView } from './clinicalFillDerivedView';

const isConcurrencyFailure = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConcurrencyError';

const writeFreshClinicalPatch = async (
  dailyRecord: DailyRecordRepositoryPort,
  patch: DailyRecordPatch,
  target: ClinicalFillPatchTarget,
  writeGuard: RayenClinicalWriteGuard,
  baseRecord: DailyRecord
): Promise<void> => {
  const fresh = await dailyRecord.getForDateWithMeta(target.censusDate, true);
  if (!fresh.record) throw new Error('No se pudo obtener la versión vigente del censo.');
  assertClinicalFillPatchTarget(fresh.record, target);
  // D10: on a split day the rebuild compares against this episode's document, read from the
  // server; a document ahead of the day re-reads the day from the server once, then fails closed.
  // The write below keeps the un-overlaid day as its base: that one reaches IndexedDB and the queue.
  const current = await readClinicalFillDerivedView(
    fresh.record,
    () => dailyRecord.getAuthoritativeForDate(target.censusDate),
    target.clinicalEpisodeId
  );
  if (current.day !== fresh.record) assertClinicalFillPatchTarget(current.record, target);
  const [operation] = rebuildClinicalEnrichmentOperations({
    baseRecord,
    currentRecord: current.record,
    operations: [{ patch, target }],
  });
  if (!operation) return;
  const result = await patchDailyRecordWithCompatibility(
    dailyRecord,
    target.censusDate,
    operation.patch,
    {
      baseRecord: fresh.record,
      historyPolicy: target.captureHistorySnapshot === false ? 'skip' : 'snapshot',
      rayenClinicalWriteGuard: writeGuard,
    }
  );
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
  target: ClinicalFillPatchTarget,
  writeGuard: RayenClinicalWriteGuard,
  baseRecord: DailyRecord
): Promise<void> => {
  assertClinicalFillPatchTarget(baseRecord, target);
  try {
    await writeFreshClinicalPatch(dailyRecord, patch, target, writeGuard, baseRecord);
  } catch (error) {
    if (!isConcurrencyFailure(error)) throw error;
    await writeFreshClinicalPatch(dailyRecord, patch, target, writeGuard, baseRecord);
  }
};
