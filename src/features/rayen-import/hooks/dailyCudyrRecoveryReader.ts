import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  ClinicalFillDeps,
  DailyCudyrRecoveryResult,
} from '../contracts/clinicalFillContracts';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import {
  captureCudyrMonthlyReport,
  CudyrMonthlyReportArchiveError,
} from '@/services/cudyr/cudyrMonthlyReportCapture';
import type { CudyrRecoveryDetail, RayenSyncIssueReason } from '@/types/domain/rayenSync';
import { planDailyCudyrGaps, recoverDailyCudyrGap } from '@/services/cudyr/dailyCudyrRecoveryPlan';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { readClinicalFillDerivedView } from './clinicalFillDerivedView';
import { buildClinicalFillError } from '../observability/rayenSyncDiagnostics';

import { collectCudyrCaptureEpisodes } from '../domain/cudyrCapturePlan';
import {
  collectSafeClinicalEpisodeIds,
  type StructuralConflict,
} from './rayenStructuralConvergence';

/** Discharges remain identified by episode even when another patient occupies their former bed. */
export const collectDailyCudyrRecoveryEpisodes = ({
  acceptedRecord,
  currentRecord,
  conflicts,
  pendingEpisodeIds,
}: {
  acceptedRecord: DailyRecord;
  currentRecord: DailyRecord;
  conflicts: readonly StructuralConflict[];
  pendingEpisodeIds?: readonly string[];
}): string[] =>
  collectSafeClinicalEpisodeIds(
    currentRecord,
    conflicts,
    collectCudyrCaptureEpisodes(acceptedRecord)
  ).filter(id => !pendingEpisodeIds || pendingEpisodeIds.includes(id));

/** This reader is installed only for a user-initiated daily synchronization (or its retry). */
export const createDailyCudyrRecoveryReader = ({
  signal,
  loadDay,
  now = () => new Date(),
  capture = captureCudyrMonthlyReport,
}: {
  signal: AbortSignal;
  loadDay: (date: string) => Promise<DailyRecord | null>;
  now?: () => Date;
  capture?: typeof captureCudyrMonthlyReport;
}): NonNullable<ClinicalFillDeps['recoverMissingCudyr']> => {
  const owner = getStoredSessionOwnerKey(),
    generation = getSessionGeneration();
  const check = () => {
    signal.throwIfAborted();
    if (owner !== getStoredSessionOwnerKey() || generation !== getSessionGeneration())
      throw new Error('La sesión cambió.');
  };
  return async (record, episodes, source) => {
    const result: DailyCudyrRecoveryResult = { current: new Map(), previous: [], errors: [] };
    if (!episodes.length) return result;
    check();
    const records = [record];
    const previousDate = previousCensusIsoDay(record.date);
    const warn = (
      episode: string | undefined,
      cudyrRecovery: CudyrRecoveryDetail,
      reason: RayenSyncIssueReason = 'source_unavailable'
    ) =>
      result.errors.push(
        buildClinicalFillError({
          bedId: '*',
          ...(episode ? { clinicalEpisodeId: episode } : {}),
          source: 'cudyr',
          reason,
          cudyrRecovery,
          error: cudyrRecovery.kind,
        })
      );
    if (resolveCudyrPendingStatus(previousDate, now()).phase === 'overdue') {
      try {
        const prior = await loadDay(previousDate);
        check();
        if (prior && prior.date !== previousDate)
          throw new Error('El censo corresponde a otra fecha.');
        if (prior)
          records.push(
            (await readClinicalFillDerivedView(prior, () => loadDay(previousDate))).record
          );
        else if (
          episodes.some(
            id =>
              !Object.values(record.beds).some(
                p => p.clinicalEpisodeId === id || p.clinicalCrib?.clinicalEpisodeId === id
              )
          )
        )
          warn(undefined, { kind: 'read_failed', targetDate: null });
      } catch {
        check();
        warn(undefined, { kind: 'read_failed', targetDate: null }, 'record_load_failed');
        return result;
      }
    }
    check();
    // The selected night may itself be closed: its application-day census is the other identity half.
    if (resolveCudyrPendingStatus(record.date, now()).phase === 'overdue') {
      const nextDate = getNextDay(record.date);
      try {
        const next = await loadDay(nextDate);
        check();
        if (next && next.date !== nextDate) throw new Error('El censo corresponde a otra fecha.');
        if (next) records.push(next);
      } catch {
        check();
        warn(undefined, { kind: 'read_failed', targetDate: null }, 'record_load_failed');
        return result;
      }
    }
    const gaps = planDailyCudyrGaps(
      records.filter(day => day.date === record.date || day.date === previousDate),
      episodes,
      source,
      now()
    );
    for (const month of new Set(gaps.map(gap => gap.sourceDate.slice(0, 7)))) {
      check();
      const monthGaps = gaps.filter(gap => gap.sourceDate.startsWith(month));
      try {
        const report = await capture(month, signal, check);
        check();
        if (
          Date.parse(report.capturedAt) > now().getTime() + 10000 ||
          monthGaps.some(
            gap =>
              resolveCudyrPendingStatus(gap.date, new Date(report.capturedAt)).phase !== 'overdue'
          )
        ) {
          for (const gap of monthGaps)
            warn(gap.clinicalEpisodeId, { kind: 'documentary_inconclusive', targetDate: gap.date });
          continue;
        }
        for (const gap of monthGaps) {
          const resolution = recoverDailyCudyrGap(gap, records, report);
          if (resolution.kind === 'not_applicable') continue;
          if (resolution.kind !== 'recovered') {
            warn(gap.clinicalEpisodeId, { kind: resolution.kind, targetDate: gap.date });
          } else if (gap.date === record.date)
            result.current.set(gap.clinicalEpisodeId, resolution.cudyr);
          else
            result.previous.push({
              clinicalEpisodeId: gap.clinicalEpisodeId,
              cudyr: resolution.cudyr,
            });
        }
      } catch (error) {
        check();
        const archiveFailed = error instanceof CudyrMonthlyReportArchiveError;
        for (const gap of monthGaps)
          warn(
            gap.clinicalEpisodeId,
            {
              kind: archiveFailed ? 'archive_unconfirmed' : 'read_failed',
              targetDate: gap.date,
            },
            archiveFailed ? 'historical_archive_failed' : 'source_unavailable'
          );
      }
    }
    check();
    return result;
  };
};
