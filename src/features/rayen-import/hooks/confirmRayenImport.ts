import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { ApplyResult } from '../domain/applyCensusImportDiff';
import { fileCrossDayCorrections } from '../domain/previousDayCorrections';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import type { CensusImportDiff, CmaAdmissionResolution } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { applyCmaAdmissionResolutions } from '../domain/cmaAdmissionReview';
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
  bedOccupancyCollisions: diff.bedOccupancyCollisions,
  bedOccupancyCollisionResolutions: diff.bedOccupancyCollisionResolutions,
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

export type ConfirmedRayenImportResult<TApplyResult extends ApplyResult> = TApplyResult & {
  appliedDiff: CensusImportDiff;
  historicalCorrectionsPending: boolean;
};

/**
 * The selected day is already authoritative, but a non-durable cross-day correction was rejected.
 * Callers may continue clinical enrichment from `committedResult`; the historical change itself
 * must be rebuilt from a fresh capture and must never be described as queued or replayable.
 */
export class RayenHistoricalCorrectionAfterCommitError extends Error {
  readonly committedResult: ConfirmedRayenImportResult<ApplyResult>;

  constructor(committedResult: ConfirmedRayenImportResult<ApplyResult>, cause: unknown) {
    super(
      'El censo del día seleccionado quedó confirmado, pero una corrección histórica no pudo guardarse. Vuelve a capturar la sincronización para recalcular esa corrección.',
      cause === undefined ? undefined : { cause }
    );
    this.name = 'RayenHistoricalCorrectionAfterCommitError';
    this.committedResult = committedResult;
  }
}

export const committedRayenImportResultFromError = <TApplyResult extends ApplyResult>(
  error: unknown
): ConfirmedRayenImportResult<TApplyResult> | null =>
  error instanceof RayenHistoricalCorrectionAfterCommitError
    ? (error.committedResult as ConfirmedRayenImportResult<TApplyResult>)
    : null;

export const applyConfirmedRayenImport = async <TApplyResult extends ApplyResult>({
  applyPreviousDays,
  cmaAdmissionResolutions = [],
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
  cmaAdmissionResolutions?: CmaAdmissionResolution[];
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
}): Promise<ConfirmedRayenImportResult<TApplyResult>> => {
  let candidate = base;
  let candidateDiff = applyCmaAdmissionResolutions(diff, cmaAdmissionResolutions);
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
      const rawReplannedDiff = await replanDiff(fresh);
      let replannedDiff: CensusImportDiff;
      try {
        replannedDiff = applyCmaAdmissionResolutions(rawReplannedDiff, cmaAdmissionResolutions);
      } catch {
        throw new RayenStructuralPlanChangedError(fresh, rawReplannedDiff);
      }
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
    if (lastHistoricalConflict !== undefined) {
      throw new RayenHistoricalCorrectionAfterCommitError(
        {
          ...appliedResult,
          appliedDiff: candidateDiff,
          historicalCorrectionsPending: false,
        },
        lastHistoricalConflict
      );
    }
  }

  return {
    ...appliedResult,
    appliedDiff: candidateDiff,
    historicalCorrectionsPending,
  };
};
