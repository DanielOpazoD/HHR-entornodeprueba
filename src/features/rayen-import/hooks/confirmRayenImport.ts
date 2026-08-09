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

const stableStringify = (value: unknown): string => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
};

const comparableStructuralPlan = (diff: CensusImportDiff) => ({
  admissions: diff.admissions,
  updates: diff.updates,
  moves: diff.moves,
  discharges: diff.discharges,
  pendingAdministrativeDischarges: diff.pendingAdministrativeDischarges,
  conflicts: diff.conflicts,
  activeClinicalCribs: diff.activeClinicalCribs,
  reportEgresos: diff.reportEgresos,
  previousDayEdits: diff.previousDayEdits,
  previousDayAdmissionCandidates: diff.previousDayAdmissionCandidates,
});

export const areRayenStructuralPlansEquivalent = (
  left: CensusImportDiff,
  right: CensusImportDiff
): boolean =>
  stableStringify(comparableStructuralPlan(left)) ===
  stableStringify(comparableStructuralPlan(right));

/** Signals that a CAS replan changed what the operator had reviewed. */
export class RayenStructuralPlanChangedError extends Error {
  readonly freshRecord: DailyRecord;
  readonly replannedDiff: CensusImportDiff;

  constructor(freshRecord: DailyRecord, replannedDiff: CensusImportDiff) {
    super(
      'El censo cambió durante la confirmación. HHR recalculó la propuesta; revísala antes de aplicarla.'
    );
    this.name = 'RayenStructuralPlanChangedError';
    this.freshRecord = freshRecord;
    this.replannedDiff = replannedDiff;
  }
}

export const isRayenStructuralPlanChangedError = (
  error: unknown
): error is RayenStructuralPlanChangedError => error instanceof RayenStructuralPlanChangedError;

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

export const applyConfirmedRayenImport = async <TApplyResult extends ApplyResult>({
  applyPreviousDays,
  base,
  diff,
  dailyRecord,
  isAdmin,
  ensureRun,
  applyDiff,
  getFreshRecord,
  replanDiff,
  clinicalDay,
  createId,
  onRetry,
}: {
  applyPreviousDays: boolean;
  base: DailyRecord;
  diff: CensusImportDiff;
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
  ensureRun: () => RayenSyncRun;
  applyDiff: (
    record: DailyRecord,
    diff: CensusImportDiff,
    clinicalDay?: string
  ) => Promise<TApplyResult>;
  getFreshRecord: () => Promise<DailyRecord | null | undefined>;
  /** Rebuilds the structural plan against a fresh revision using the already captured evidence. */
  replanDiff: (record: DailyRecord) => Promise<CensusImportDiff>;
  clinicalDay?: string;
  createId: () => string;
  onRetry?: () => void;
}): Promise<
  TApplyResult & { appliedDiff: CensusImportDiff; historicalCorrectionsPending: boolean }
> => {
  let candidate = base;
  let candidateDiff = diff;
  let lastConflict: unknown;
  let appliedResult: TApplyResult | undefined;
  for (let attempt = 0; attempt <= MAX_FRESH_RECORD_RETRIES; attempt += 1) {
    try {
      appliedResult = await applyDiff(candidate, candidateDiff, clinicalDay);
      break;
    } catch (error) {
      if (!isVersionConflict(error)) throw error;
      lastConflict = error;
      if (attempt === MAX_FRESH_RECORD_RETRIES) break;
      onRetry?.();
      const fresh = await getFreshRecord();
      if (!fresh) throw error;
      const replannedDiff = await replanDiff(fresh);
      if (!areRayenStructuralPlansEquivalent(candidateDiff, replannedDiff)) {
        throw new RayenStructuralPlanChangedError(fresh, replannedDiff);
      }
      candidate = fresh;
      candidateDiff = replannedDiff;
    }
  }

  if (!appliedResult) throw lastConflict;

  // Historical edits must correspond to the structural plan that actually won the CAS. Running
  // them before the selected-day save can persist an obsolete plan and a later replan can then be
  // reported as applied even though its historical changes never ran.
  let historicalCorrectionsPending = false;
  if (applyPreviousDays) {
    const run = ensureRun();
    let lastHistoricalConflict: unknown;
    for (let attempt = 0; attempt <= MAX_FRESH_RECORD_RETRIES; attempt += 1) {
      try {
        const correctionResult = await fileCrossDayCorrections(
          dailyRecord,
          candidate,
          candidateDiff,
          clinicalDay ?? toIsoReportDate(candidate),
          isAdmin,
          createId,
          { actor: run.by, syncRunId: run.id }
        );
        historicalCorrectionsPending = correctionResult.durablyQueued > 0;
        lastHistoricalConflict = undefined;
        break;
      } catch (error) {
        lastHistoricalConflict = error;
        if (!isVersionConflict(error)) break;
        if (attempt === MAX_FRESH_RECORD_RETRIES) break;
        onRetry?.();
      }
    }
    // Only a correction proven durable in the existing local outbox is resumable. A failure before
    // that point cannot be represented by the generic audit marker, so fail explicitly rather than
    // claiming that a future run can replay inputs that were never persisted.
    if (lastHistoricalConflict) throw lastHistoricalConflict;
  }

  return { ...appliedResult, appliedDiff: candidateDiff, historicalCorrectionsPending };
};
