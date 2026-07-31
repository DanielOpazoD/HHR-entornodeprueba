import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { ApplyResult } from '../domain/applyCensusImportDiff';
import { fileCrossDayCorrections } from '../domain/previousDayCorrections';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { getRayenImportErrorMessage } from './rayenImportState';
import { toIsoReportDate } from './reportDateHelpers';

const isVersionConflict = (error: unknown): boolean =>
  (error instanceof Error && error.name === 'ConcurrencyError') ||
  /actualizó hace un momento/i.test(getRayenImportErrorMessage(error));

const MAX_FRESH_RECORD_RETRIES = 2;

export const hasSkippedPreviousDayCorrections = (
  diff: CensusImportDiff,
  applyPreviousDays: boolean
): boolean => {
  const previousDayEdits = diff.previousDayEdits ?? [];
  return (
    previousDayEdits.length > 0 &&
    (!applyPreviousDays ||
      previousDayEdits.some(
        edit => !edit.recordExists || !edit.withinEditingWindow || edit.isSigned
      ))
  );
};

export const applyConfirmedRayenImport = async ({
  applyPreviousDays,
  base,
  diff,
  dailyRecord,
  isAdmin,
  ensureRun,
  applyDiff,
  getFreshRecord,
  createId,
  onRetry,
}: {
  applyPreviousDays: boolean;
  base: DailyRecord;
  diff: CensusImportDiff;
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
  ensureRun: () => RayenSyncRun;
  applyDiff: (record: DailyRecord, diff: CensusImportDiff) => Promise<ApplyResult>;
  getFreshRecord: () => Promise<DailyRecord | null | undefined>;
  createId: () => string;
  onRetry?: () => void;
}): Promise<ApplyResult> => {
  if (applyPreviousDays) {
    const run = ensureRun();
    let lastHistoricalConflict: unknown;
    for (let attempt = 0; attempt <= MAX_FRESH_RECORD_RETRIES; attempt += 1) {
      try {
        await fileCrossDayCorrections(
          dailyRecord,
          base,
          diff,
          toIsoReportDate(base),
          isAdmin,
          createId,
          { actor: run.by, syncRunId: run.id }
        );
        lastHistoricalConflict = undefined;
        break;
      } catch (error) {
        if (!isVersionConflict(error)) throw error;
        lastHistoricalConflict = error;
        if (attempt === MAX_FRESH_RECORD_RETRIES) break;
        onRetry?.();
      }
    }
    if (lastHistoricalConflict) throw lastHistoricalConflict;
  }

  let candidate = base;
  let lastConflict: unknown;
  for (let attempt = 0; attempt <= MAX_FRESH_RECORD_RETRIES; attempt += 1) {
    try {
      return await applyDiff(candidate, diff);
    } catch (error) {
      if (!isVersionConflict(error)) throw error;
      lastConflict = error;
      if (attempt === MAX_FRESH_RECORD_RETRIES) break;
      onRetry?.();
      const fresh = await getFreshRecord();
      if (!fresh) throw error;
      candidate = fresh;
    }
  }

  throw lastConflict;
};
