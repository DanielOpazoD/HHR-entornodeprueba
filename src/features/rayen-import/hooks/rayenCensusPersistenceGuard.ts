import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecord } from '../contracts/rayenDomainContracts';

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
  readonly [CONFIRMED_RAYEN_CENSUS_HANDOFF]: true;
}

export const isConfirmedRayenCensusHandoff = (
  value: DailyRecord | ConfirmedRayenCensusHandoff
): value is ConfirmedRayenCensusHandoff =>
  (value as Partial<ConfirmedRayenCensusHandoff>)[CONFIRMED_RAYEN_CENSUS_HANDOFF] === true;

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
    throw new Error(
      'El censo quedó guardado localmente, pero todavía no fue confirmado en la nube. La información clínica no se aplicó para evitar mezclar versiones; espera un momento y vuelve a sincronizar.'
    );
  }
};

/**
 * Returns the exact structural census accepted for this synchronization run.
 * The handoff is intentionally strict: clinical enrichment must never continue with a record
 * from another day or run, even when the persistence result itself was clean.
 */
export const resolveConfirmedRayenCensusHandoff = (
  payload: RayenCensusPersistencePayload,
  expected: { date: string; runId: string }
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
  return {
    record,
    runId: expected.runId,
    [CONFIRMED_RAYEN_CENSUS_HANDOFF]: true,
  };
};
