import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { ApplyResult } from '../domain/applyCensusImportDiff';
import { fileCrossDayCorrections } from '../domain/previousDayCorrections';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { getRayenImportErrorMessage } from './rayenImportState';
import { toIsoReportDate } from './reportDateHelpers';

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
}: {
  applyPreviousDays: boolean;
  base: DailyRecord;
  diff: CensusImportDiff;
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
  ensureRun: () => RayenSyncRun;
  applyDiff: (record: DailyRecord, diff: CensusImportDiff) => Promise<ApplyResult>;
  getFreshRecord: () => DailyRecord | null | undefined;
  createId: () => string;
}): Promise<ApplyResult> => {
  if (applyPreviousDays) {
    const run = ensureRun();
    await fileCrossDayCorrections(
      dailyRecord,
      base,
      diff,
      toIsoReportDate(base),
      isAdmin,
      createId,
      { actor: run.by, syncRunId: run.id }
    );
  }

  try {
    return await applyDiff(base, diff);
  } catch (error) {
    if (!/actualizó hace un momento/i.test(getRayenImportErrorMessage(error))) throw error;
    await new Promise(resolve => setTimeout(resolve, 900));
    const fresh = getFreshRecord();
    if (!fresh) throw error;
    return applyDiff(fresh, diff);
  }
};
