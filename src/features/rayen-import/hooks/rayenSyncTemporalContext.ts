import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusSyncTarget } from '../domain/historicalCensusSync';
import { resolveCensusSyncTarget } from '../domain/historicalCensusSync';
import { resolveSyncReportRequest, toIsoReportDate } from './reportDateHelpers';
import type { RayenImportPolicy } from '../settings/rayenImportSettings';
import { RAYEN_SYNC_TIME_ZONE, type RayenSyncExecutionContext } from './rayenSyncExecutionState';

export interface PreparedRayenSyncContext {
  runId: string;
  record: DailyRecord;
  selectedDate: string;
  target: CensusSyncTarget;
  range: { dateStart: string; dateEnd: string };
  preparedAt: string;
}

export type RayenSyncTemporalValidation =
  | { valid: true; completedTarget: CensusSyncTarget }
  | {
      valid: false;
      reason: 'unsupported' | 'clinical_day_changed';
      completedTarget: CensusSyncTarget;
    };

interface PrepareRayenSyncTemporalContextInput {
  displayedRecord: DailyRecord;
  runId: string;
  loadFreshRecord: (date: string) => Promise<DailyRecord>;
  now?: () => Date;
}

/**
 * Freezes the selected census day and its freshest persisted state before requesting Rayen.
 * The complete run must plan and persist against this context, even when synchronizing D-1.
 */
export const prepareRayenSyncTemporalContext = async ({
  displayedRecord,
  runId,
  loadFreshRecord,
  now = () => new Date(),
}: PrepareRayenSyncTemporalContextInput): Promise<PreparedRayenSyncContext> => {
  const selectedDate = toIsoReportDate(displayedRecord);
  const record = await loadFreshRecord(selectedDate);
  if (toIsoReportDate(record) !== selectedDate) {
    throw new Error('La versión vigente no corresponde al día de censo seleccionado.');
  }

  const preparedAt = now();
  const request = resolveSyncReportRequest(record, preparedAt);
  return {
    runId,
    record,
    selectedDate,
    target: request.target,
    range: request.range,
    preparedAt: preparedAt.toISOString(),
  };
};

/** Completes the immutable execution context once the extension request id is known. */
export const createRayenSyncExecutionContext = (
  prepared: PreparedRayenSyncContext,
  requestId: string,
  policy: RayenImportPolicy
): RayenSyncExecutionContext => {
  if (prepared.target.kind === 'unsupported' || prepared.target.lookbackDays === null) {
    throw new Error(
      'Solo se puede sincronizar el censo vigente o uno de los siete días anteriores.'
    );
  }
  return {
    runId: prepared.runId,
    requestId,
    selectedDate: prepared.selectedDate,
    clinicalDay: prepared.target.clinicalDay,
    timeZone: RAYEN_SYNC_TIME_ZONE,
    target: prepared.target.kind,
    lookbackDays: prepared.target.lookbackDays,
    baseRevision: prepared.record.lastUpdated,
    policy: Object.freeze({ ...policy }),
    policyRevision: policy.revision,
    queryRange: Object.freeze({ ...prepared.range }),
    preparedAt: prepared.preparedAt,
  };
};

/**
 * Confirms that a capture still belongs to the clinical day frozen at its start.
 * A run crossing the nursing handoff must be restarted so its evidence never mixes two shifts.
 */
export const validatePreparedRayenSyncContextAtCompletion = (
  context: PreparedRayenSyncContext,
  now: Date = new Date()
): RayenSyncTemporalValidation => {
  const completedTarget = resolveCensusSyncTarget(toIsoReportDate(context.record), now);
  if (context.target.kind === 'unsupported' || completedTarget.kind === 'unsupported') {
    return { valid: false, reason: 'unsupported', completedTarget };
  }
  if (completedTarget.clinicalDay !== context.target.clinicalDay) {
    return { valid: false, reason: 'clinical_day_changed', completedTarget };
  }
  return { valid: true, completedTarget };
};
