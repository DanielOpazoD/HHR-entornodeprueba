import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';

export interface RayenCensusPersistencePayload {
  result: SaveDailyRecordResult | null;
}

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
