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
import type { RayenClinicalWriteGuard } from '@/types/domain/rayenSync';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { resolveHistoricalCudyrBatchOperation } from '../domain/historicalCudyrPatch';

type ApplyClinicalEnrichmentBatch =
  typeof import('./applyClinicalEnrichmentBatch').applyClinicalEnrichmentBatch;

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
  writeGuard,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  censusDay: string;
  items: HistoricalCudyrBatchItem[];
  writeGuard?: RayenClinicalWriteGuard;
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
    ...(writeGuard ? { rayenClinicalWriteGuard: writeGuard } : {}),
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

export const applyHistoricalCudyrBatch = async ({
  dailyRecord,
  censusDay,
  items,
  isAdmin,
  writeGuard,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  censusDay: string;
  items: HistoricalCudyrBatchItem[];
  isAdmin: boolean;
  writeGuard?: RayenClinicalWriteGuard;
}): Promise<HistoricalCudyrBatchItemResult[]> => {
  const uniqueItems = uniqueBatchItems(items);
  if (uniqueItems.length === 0) return [];
  const canWriteTargetDay = writeGuard
    ? canWriteAuthoritativeHistoricalDay({
        censusDay,
        sourceDate: writeGuard.sourceDate,
        isAdmin,
      })
    : canWritePreviousDay(censusDay, isAdmin);
  if (!canWriteTargetDay) {
    return uniqueItems.map(({ clinicalEpisodeId }) => ({
      clinicalEpisodeId,
      persisted: false,
      changed: false,
    }));
  }
  const input = { dailyRecord, censusDay, items: uniqueItems, writeGuard };
  try {
    return await writeHistoricalCudyrBatch(input);
  } catch (error) {
    if (!isConcurrencyFailure(error)) throw error;
    // One bounded retry rehydrates the latest revision and recomputes the whole granular batch.
    return writeHistoricalCudyrBatch(input);
  }
};

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
}): Promise<HistoricalCudyrBatchItemResult[]> => {
  const uniqueItems = uniqueBatchItems(items);
  if (uniqueItems.length === 0) return [];
  if (
    !canWriteAuthoritativeHistoricalDay({
      censusDay,
      sourceDate: sourceRecord.date,
      isAdmin,
    })
  ) {
    return uniqueItems.map(({ clinicalEpisodeId }) => ({
      clinicalEpisodeId,
      persisted: false,
      changed: false,
    }));
  }

  const loadHistoricalRecord = async (): Promise<DailyRecord> => {
    const historicalRecord = (await dailyRecord.getForDateWithMeta(censusDay, true)).record;
    if (!historicalRecord) throw new Error('No existe el censo histórico para archivar CUDYR.');
    return historicalRecord;
  };
  const historicalRecord = await loadHistoricalRecord();
  const resolutions = uniqueItems.map(({ clinicalEpisodeId, cudyr }) => ({
    clinicalEpisodeId,
    ...resolveHistoricalCudyrBatchOperation(historicalRecord, clinicalEpisodeId, cudyr),
  }));
  const authoritativeItems = uniqueItems.filter(item =>
    resolutions.some(
      resolution =>
        resolution.clinicalEpisodeId === item.clinicalEpisodeId && Boolean(resolution.operation)
    )
  );
  const rebuildOperations = (record: DailyRecord) => {
    const rebuilt = authoritativeItems.map(({ clinicalEpisodeId, cudyr }) =>
      resolveHistoricalCudyrBatchOperation(record, clinicalEpisodeId, cudyr)
    );
    if (rebuilt.some(resolution => !resolution.matched)) {
      throw new Error('El episodio histórico cambió durante la actualización de CUDYR.');
    }
    return rebuilt.flatMap(({ operation }) => (operation ? [operation] : []));
  };
  const operations = resolutions.flatMap(({ operation }) => (operation ? [operation] : []));
  if (operations.length > 0) {
    const authoritativeApplyBatch =
      applyBatch ?? (await import('./applyClinicalEnrichmentBatch')).applyClinicalEnrichmentBatch;
    await authoritativeApplyBatch({
      mode: 'enforced',
      record: historicalRecord,
      authorityDate: sourceRecord.date,
      runId,
      operations,
      rebuildOperations,
      applyPatch: async () => {
        throw new Error('El modo enforced no permite el escritor histórico individual.');
      },
      refreshRecord: loadHistoricalRecord,
    });
  }

  return resolutions.map(({ clinicalEpisodeId, matched, operation }) => ({
    clinicalEpisodeId,
    persisted: matched,
    changed: Boolean(operation),
    ...(!matched ? { applicable: false as const } : {}),
  }));
};

export const applyHistoricalCudyr = async ({
  dailyRecord,
  clinicalEpisodeId,
  censusDay,
  cudyr,
  isAdmin,
  writeGuard,
}: {
  dailyRecord: DailyRecordRepositoryPort;
  clinicalEpisodeId: string;
  censusDay: string;
  cudyr: ImportedCudyr;
  isAdmin: boolean;
  writeGuard?: RayenClinicalWriteGuard;
}): Promise<HistoricalCudyrApplyResult> => {
  const [result] = await applyHistoricalCudyrBatch({
    dailyRecord,
    censusDay,
    items: [{ clinicalEpisodeId, cudyr }],
    isAdmin,
    writeGuard,
  });
  if (!result) return { persisted: false, changed: false, applicable: false };
  const { clinicalEpisodeId: _clinicalEpisodeId, ...singleResult } = result;
  return singleResult;
};
