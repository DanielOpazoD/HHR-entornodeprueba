import { withRetry } from '@/utils/networkUtils';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import {
  patchDailyRecordWithClinicalAuthorityCallable,
  shouldRetryDailyRecordAuthorityError,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { buildAuthorityPatchSyncContract } from '@/services/storage/firestore/firestoreRecordWritePatchPolicy';
import { extractDailyRecordBedTreePatch } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { isPermissionDeniedError } from '@/services/storage/firestore/firestoreRecordWriteUtilities';
import { firestoreWriteLogger } from '@/services/storage/storageLoggers';

/**
 * Escalera de recuperación del parche parcial directo.
 *
 * El enrutamiento hacia el callable depende de una lectura ADVISORY de la
 * política (con catch → false): una carrera de token al arrancar la deja en
 * falso, el cliente escribe directo y las reglas schema-v2 lo rechazan —
 * seguro para los datos, pero la edición del usuario quedaba «solo local»
 * (verificado en vivo 31-08 agregando SNG). El permission-denied del write
 * directo sobre el árbol de camas es en sí la prueba de que la valla está
 * activa: tras agotar el refresh de claim, el parche de camas se reintenta
 * UNA vez por el callable autoritativo, sin volver a consultar la advisory.
 */
export const runPartialUpdatePersistWithPermissionFallbacks = async <TResult>({
  persist,
  date,
  sanitizedPatch,
  expectedLastUpdated,
  syncContract,
  tryRefreshCurrentUserRoleClaim,
}: {
  persist: () => Promise<TResult>;
  date: string;
  sanitizedPatch: Record<string, unknown>;
  expectedLastUpdated?: string;
  syncContract?: SyncTaskContract;
  tryRefreshCurrentUserRoleClaim: (date: string) => Promise<boolean>;
}): Promise<TResult> => {
  const retryBedTreeViaCallable = async (error: unknown): Promise<TResult | null> => {
    if (!isPermissionDeniedError(error)) return null;
    const bedTreePatch = extractDailyRecordBedTreePatch(sanitizedPatch);
    if (Object.keys(bedTreePatch).length === 0) return null;
    firestoreWriteLogger.warn(
      'Parche de camas rechazado por reglas en escritura directa: reintentando por el callable autoritativo.',
      { date, paths: Object.keys(bedTreePatch) }
    );
    try {
      return await withRetry(
        () =>
          patchDailyRecordWithClinicalAuthorityCallable({
            date,
            patch: bedTreePatch,
            expectedLastUpdated,
            mode: 'enforced',
            origin: 'direct_write_permission_fallback',
            syncContract: buildAuthorityPatchSyncContract(syncContract, bedTreePatch),
          }) as Promise<TResult>,
        { shouldRetry: shouldRetryDailyRecordAuthorityError }
      );
    } catch (fallbackError) {
      // El fallback es oportunista: si el callable tampoco puede (documento
      // inexistente, infra no disponible), el error ORIGINAL de permisos es
      // el diagnóstico veraz para el caller y sus recuperaciones.
      firestoreWriteLogger.warn('El reintento por el callable autoritativo también falló.', {
        date,
        fallbackError,
      });
      return null;
    }
  };

  try {
    return await persist();
  } catch (error) {
    if (isPermissionDeniedError(error) && (await tryRefreshCurrentUserRoleClaim(date))) {
      try {
        return await persist();
      } catch (retryError) {
        const fallback = await retryBedTreeViaCallable(retryError);
        if (fallback !== null) return fallback;
        throw retryError;
      }
    }
    const fallback = await retryBedTreeViaCallable(error);
    if (fallback !== null) return fallback;
    throw error;
  }
};
