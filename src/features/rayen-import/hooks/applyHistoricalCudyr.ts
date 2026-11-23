import type { UserRole } from '@/types/authRoleTypes';
import { guardAuthoringSession } from '@/services/session/authoringSession';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type {
  HistoricalCudyrBatchExecutionResult,
  HistoricalCudyrBatchItem,
} from '../contracts/clinicalFillContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { resolveHistoricalCudyrBatchOperation } from '../domain/historicalCudyrPatch';
import { readClinicalFillDerivedView } from './clinicalFillDerivedView';
import { canApplyPreviousDayCudyr } from '@/shared/access/censusDayWriteAccessPolicy';

type ApplyClinicalEnrichmentBatch =
  typeof import('./applyClinicalEnrichmentBatch').applyClinicalEnrichmentBatch;

const uniqueBatchItems = (items: HistoricalCudyrBatchItem[]): HistoricalCudyrBatchItem[] => [
  ...new Map(items.map(item => [item.clinicalEpisodeId, item])).values(),
];

/**
 * Persists the previous census day's CUDYR values through the same authoritative callable used
 * for the current day. The target record owns the clinical mutation while sourceRecord proves the
 * user-initiated synchronization run; no per-record writer participates.
 */
export const applyHistoricalCudyrBatchAuthoritatively = async ({
  checkSession,
  dailyRecord,
  sourceRecord,
  censusDay,
  items,
  role,
  runId,
  applyBatch,
}: {
  checkSession?: () => void;
  dailyRecord: DailyRecordRepositoryPort;
  sourceRecord: DailyRecord;
  censusDay: string;
  items: HistoricalCudyrBatchItem[];
  role: UserRole | null;
  runId: string;
  applyBatch?: ApplyClinicalEnrichmentBatch;
}): Promise<HistoricalCudyrBatchExecutionResult> => {
  const session = guardAuthoringSession();
  const check = () => {
    checkSession?.();
    session.check();
  };
  check();
  const uniqueItems = uniqueBatchItems(items);
  if (uniqueItems.length === 0) return { results: [] };
  if (
    !canApplyPreviousDayCudyr({
      censusDay,
      sourceDate: sourceRecord.date,
      role,
    })
  ) {
    return {
      results: uniqueItems.map(({ clinicalEpisodeId }) => ({
        clinicalEpisodeId,
        persisted: false,
        changed: false,
        applicable: false,
      })),
    };
  }

  const loadHistoricalRecord = async (): Promise<DailyRecord> => {
    const historicalRecord = await dailyRecord.getAuthoritativeForDate(censusDay);
    check();
    if (!historicalRecord) throw new Error('No existe el censo histórico para archivar CUDYR.');
    const view = await readClinicalFillDerivedView(historicalRecord, () =>
      dailyRecord.getAuthoritativeForDate(censusDay)
    );
    check();
    return view.record;
  };
  const historicalRecord = await dailyRecord.getAuthoritativeForDate(censusDay);
  check();
  // A previous CUDYR application can exist even when HHR has no census for that owning night.
  // There is no destination to amend in that case, so the archive is not applicable and must not
  // turn an otherwise successful current-day synchronization into a visible partial conflict.
  if (!historicalRecord) {
    return {
      results: uniqueItems.map(({ clinicalEpisodeId }) => ({
        clinicalEpisodeId,
        persisted: false,
        changed: false,
        applicable: false,
      })),
    };
  }
  const historicalView = await readClinicalFillDerivedView(historicalRecord, () =>
    dailyRecord.getAuthoritativeForDate(censusDay)
  );
  check();
  const resolutions = uniqueItems.map(({ clinicalEpisodeId, cudyr }) => ({
    clinicalEpisodeId,
    ...resolveHistoricalCudyrBatchOperation(historicalView.record, clinicalEpisodeId, cudyr),
  }));
  const effectiveResolutions = new Map(
    resolutions.map(resolution => [resolution.clinicalEpisodeId, resolution])
  );
  const authoritativeItems = uniqueItems.filter(item =>
    resolutions.some(
      resolution =>
        resolution.clinicalEpisodeId === item.clinicalEpisodeId && Boolean(resolution.operation)
    )
  );
  const rebuildOperations = (record: DailyRecord) => {
    const rebuilt = authoritativeItems.map(({ clinicalEpisodeId, cudyr }) => ({
      clinicalEpisodeId,
      ...resolveHistoricalCudyrBatchOperation(record, clinicalEpisodeId, cudyr),
    }));
    // Isolate any episode that left or changed concurrently instead of aborting the other patients.
    rebuilt.forEach(resolution =>
      effectiveResolutions.set(resolution.clinicalEpisodeId, resolution)
    );
    return rebuilt.flatMap(({ operation }) => (operation ? [operation] : []));
  };
  const operations = resolutions.flatMap(({ operation }) => (operation ? [operation] : []));
  let persistence: HistoricalCudyrBatchExecutionResult['persistence'];
  let retries = 0;
  if (operations.length > 0) {
    const authoritativeApplyBatch =
      applyBatch ?? (await import('./applyClinicalEnrichmentBatch')).applyClinicalEnrichmentBatch;
    check();
    const batchResult = await authoritativeApplyBatch({
      checkSession: check,
      record: historicalView.day,
      authorityDate: sourceRecord.date,
      runId,
      operations,
      rebuildOperations,
      refreshRecord: loadHistoricalRecord,
      refreshCommittedRecord: () => dailyRecord.getAuthoritativeForDate(censusDay),
    });
    check();
    persistence = batchResult.persistence;
    retries = batchResult.retries ?? 0;
  }

  return {
    results: uniqueItems.map(({ clinicalEpisodeId }) => {
      const resolution = effectiveResolutions.get(clinicalEpisodeId);
      const matched = Boolean(resolution?.matched);
      return {
        clinicalEpisodeId,
        persisted: matched && !resolution?.administrativeOverridePreserved,
        changed: Boolean(resolution?.operation),
        ...(!matched ? { applicable: false as const } : {}),
        ...(resolution?.administrativeOverridePreserved
          ? { administrativeOverridePreserved: true as const }
          : {}),
      };
    }),
    ...(persistence ? { persistence } : {}),
    ...(!persistence && retries > 0 ? { retries } : {}),
  };
};
