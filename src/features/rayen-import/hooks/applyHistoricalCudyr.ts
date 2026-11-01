import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type {
  HistoricalCudyrBatchExecutionResult,
  HistoricalCudyrBatchItem,
} from '../contracts/clinicalFillContracts';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { resolveHistoricalCudyrBatchOperation } from '../domain/historicalCudyrPatch';
import { readClinicalFillDerivedView } from './clinicalFillDerivedView';

type ApplyClinicalEnrichmentBatch =
  typeof import('./applyClinicalEnrichmentBatch').applyClinicalEnrichmentBatch;

const uniqueBatchItems = (items: HistoricalCudyrBatchItem[]): HistoricalCudyrBatchItem[] => [
  ...new Map(items.map(item => [item.clinicalEpisodeId, item])).values(),
];

const previousIsoDay = (day: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const canWriteAuthoritativeHistoricalDay = ({
  censusDay,
  sourceDate,
  isAdmin,
}: {
  censusDay: string;
  sourceDate: string;
  isAdmin: boolean;
}): boolean => isAdmin && previousIsoDay(sourceDate) === censusDay;

/**
 * Persists the previous census day's CUDYR values through the same authoritative callable used
 * for the current day. The target record owns the clinical mutation while sourceRecord proves the
 * user-initiated synchronization run; no per-record writer participates in enforced mode.
 */
export const applyHistoricalCudyrBatchAuthoritatively = async ({
  dailyRecord,
  sourceRecord,
  censusDay,
  items,
  isAdmin,
  runId,
  applyBatch,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  sourceRecord: DailyRecord;
  censusDay: string;
  items: HistoricalCudyrBatchItem[];
  isAdmin: boolean;
  runId: string;
  applyBatch?: ApplyClinicalEnrichmentBatch;
}): Promise<HistoricalCudyrBatchExecutionResult> => {
  const uniqueItems = uniqueBatchItems(items);
  if (uniqueItems.length === 0) return { results: [] };
  if (
    !canWriteAuthoritativeHistoricalDay({
      censusDay,
      sourceDate: sourceRecord.date,
      isAdmin,
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
    if (!historicalRecord) throw new Error('No existe el censo histórico para archivar CUDYR.');
    return (
      await readClinicalFillDerivedView(historicalRecord, () =>
        dailyRecord.getAuthoritativeForDate(censusDay)
      )
    ).record;
  };
  const historicalRecord = await dailyRecord.getAuthoritativeForDate(censusDay);
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
    if (rebuilt.some(resolution => !resolution.matched)) {
      throw new Error('El episodio histórico cambió durante la actualización de CUDYR.');
    }
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
    const batchResult = await authoritativeApplyBatch({
      mode: 'enforced',
      record: historicalView.day,
      authorityDate: sourceRecord.date,
      runId,
      operations,
      rebuildOperations,
      refreshRecord: loadHistoricalRecord,
    });
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
