import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import {
  collectSafeClinicalEpisodeIds,
  describeStructuralConflicts,
  type StructuralConflict,
} from './rayenStructuralConvergence';

export interface RayenCensusPersistencePayload {
  record: DailyRecord;
  result: SaveDailyRecordResult | null;
}

const CONFIRMED_RAYEN_CENSUS_HANDOFF = Symbol('confirmed-rayen-census-handoff');

/**
 * In-memory proof that persistence accepted this exact structural census for a Rayen run.
 * The private symbol prevents a merely locally stamped DailyRecord from impersonating the
 * authoritative handoff and bypassing the compatibility revalidation read.
 */
export interface ConfirmedRayenCensusHandoff {
  readonly record: DailyRecord;
  readonly runId: string;
  readonly selectedDate: string;
  readonly clinicalDay: string;
  readonly acceptedRevision: string;
  readonly safeClinicalEpisodeIds: readonly string[];
  readonly isolatedConflicts: readonly StructuralConflict[];
  /** The selected-day census won its CAS, but one or more cross-day corrections still need retry. */
  readonly historicalCorrectionsPending?: true;
  /** The selected day is confirmed, but cross-day evidence must be captured again. */
  readonly historicalCorrectionsRequireFreshCapture?: true;
  readonly [CONFIRMED_RAYEN_CENSUS_HANDOFF]: true;
}

export type StructuralStageResult =
  | { status: 'confirmed'; handoff: ConfirmedRayenCensusHandoff }
  | {
      status: 'confirmed_with_conflicts';
      handoff: ConfirmedRayenCensusHandoff;
      conflicts: readonly StructuralConflict[];
    }
  | { status: 'blocked'; reasons: readonly StructuralConflict[] };

export const isConfirmedRayenCensusHandoff = (
  value: DailyRecord | ConfirmedRayenCensusHandoff
): value is ConfirmedRayenCensusHandoff =>
  (value as Partial<ConfirmedRayenCensusHandoff>)[CONFIRMED_RAYEN_CENSUS_HANDOFF] === true;

/** Carries resumable cross-day work into the persisted terminal audit of the same run. */
export const markRayenHistoricalCorrectionsPending = (
  handoff: ConfirmedRayenCensusHandoff
): ConfirmedRayenCensusHandoff => ({
  ...handoff,
  historicalCorrectionsPending: true,
  [CONFIRMED_RAYEN_CENSUS_HANDOFF]: true,
});

/** Preserves the confirmed selected-day census while surfacing non-durable cross-day work. */
export const markRayenHistoricalCorrectionsRequireFreshCapture = (
  handoff: ConfirmedRayenCensusHandoff
): ConfirmedRayenCensusHandoff => ({
  ...handoff,
  historicalCorrectionsRequireFreshCapture: true,
  [CONFIRMED_RAYEN_CENSUS_HANDOFF]: true,
});

export const applyRayenHistoricalCorrectionState = (
  handoff: ConfirmedRayenCensusHandoff,
  state: { pending: boolean; requiresFreshCapture: boolean }
): ConfirmedRayenCensusHandoff =>
  state.requiresFreshCapture
    ? markRayenHistoricalCorrectionsRequireFreshCapture(handoff)
    : state.pending
      ? markRayenHistoricalCorrectionsPending(handoff)
      : handoff;

/**
 * Clinical enrichment must start only after the structural census write is authoritative.
 * A queued or auto-merged full save is safe for eventual recovery, but its remote structure can
 * still be stale, so applying patient patches immediately could target the previous bed layout.
 */
export const assertRayenCensusPersistenceConfirmed = (
  payload: RayenCensusPersistencePayload
): void => {
  const { result } = payload;
  if (!result) {
    throw new Error(
      'No se pudo confirmar el resultado del guardado del censo. La información clínica no se aplicó; actualiza la página y vuelve a sincronizar.'
    );
  }

  if (isDailyRecordWriteRejectedResult(result)) {
    throw (
      result.blockingError ??
      new Error(result.userSafeMessage || 'No fue posible guardar la estructura del censo.')
    );
  }

  if (result.outcome !== 'clean') {
    const pendingWrite = new Error(
      result.userSafeMessage ||
        'El censo quedó guardado localmente y está pendiente de confirmación en la nube. La información clínica no se aplicó; vuelve a sincronizar cuando termine el guardado.'
    );
    if (result.conflictSummary?.kind === 'concurrency') {
      pendingWrite.name = 'ConcurrencyError';
    }
    throw pendingWrite;
  }
};

/**
 * Returns the exact structural census accepted for this synchronization run.
 * The handoff is intentionally strict: clinical enrichment must never continue with a record
 * from another day or run, even when the persistence result itself was clean.
 */
export const resolveConfirmedRayenCensusHandoff = (
  payload: RayenCensusPersistencePayload,
  expected: {
    date: string;
    clinicalDay?: string;
    runId: string;
    diff?: Pick<CensusImportDiff, 'conflicts'>;
  }
): ConfirmedRayenCensusHandoff => {
  assertRayenCensusPersistenceConfirmed(payload);
  const { record, result } = payload;
  const appliedEvent = record.rayenSyncHistory?.find(event => event.id === expected.runId);
  if (
    result?.date !== expected.date ||
    record.date !== expected.date ||
    record.rayenSync?.runId !== expected.runId ||
    appliedEvent?.status !== 'applied'
  ) {
    throw new Error(
      'El guardado del censo no confirmó la versión de esta sincronización. La información clínica quedó pendiente y puede reintentarse sin volver a importar pacientes.'
    );
  }
  const isolatedConflicts = describeStructuralConflicts(expected.diff?.conflicts ?? []);
  return {
    record,
    runId: expected.runId,
    selectedDate: expected.date,
    clinicalDay: expected.clinicalDay ?? expected.date,
    acceptedRevision: record.lastUpdated,
    safeClinicalEpisodeIds: collectSafeClinicalEpisodeIds(record, isolatedConflicts),
    isolatedConflicts,
    [CONFIRMED_RAYEN_CENSUS_HANDOFF]: true,
  };
};

export const resolveStructuralStageResult = (
  handoff: ConfirmedRayenCensusHandoff
): StructuralStageResult => {
  if (handoff.isolatedConflicts.length === 0) return { status: 'confirmed', handoff };
  if (handoff.safeClinicalEpisodeIds.length === 0) {
    return { status: 'blocked', reasons: handoff.isolatedConflicts };
  }
  return {
    status: 'confirmed_with_conflicts',
    handoff,
    conflicts: handoff.isolatedConflicts,
  };
};
