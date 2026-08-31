import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { buildDailyRecordSyncContract } from '@/services/storage/sync/syncTaskContractPolicy';
import {
  buildGuardedDailyRecordRemoteWriteOptions,
  type GuardedDailyRecordPatchPolicy,
} from '@/services/repositories/dailyRecordGuardedCommandPolicy';
import {
  getValueAtPath,
  hasSameValuesAtPaths,
} from '@/services/repositories/conflictResolutionUtils';
import { isValidRemoteAuthorityRecord } from '@/services/repositories/dailyRecordRemotePersistenceState';

export interface StaleVersionRebaseRetryHooks<TResult> {
  retryRemoteWriteOnStaleVersion?: (freshRemoteRecord: DailyRecord) => Promise<TResult | void>;
  canRebaseStaleVersionConflict?: (freshRemoteRecord: DailyRecord) => boolean;
}

/**
 * Un patch granular corriente (sin CAS atómico ni guardas Rayen) puede perder
 * el CAS del servidor sólo porque otra escritura propia avanzó la versión
 * entre medio (ráfagas de edición). Si los campos de ESTE patch no cambiaron
 * remotamente respecto de la base local, re-basar la versión y reintentar una
 * vez es seguro y evita degradar a auto-merge + re-encolar el registro entero.
 */
export const buildGranularPatchStaleVersionRetryHooks = <TResult>({
  date,
  options,
  policy,
  isReclassification,
  semanticChangedPaths,
  baseRecord,
  validatedRecord,
}: {
  date: string;
  options: PartialUpdateDailyRecordOptions;
  policy: GuardedDailyRecordPatchPolicy;
  isReclassification: boolean;
  semanticChangedPaths: string[];
  baseRecord: DailyRecord;
  validatedRecord: DailyRecord;
}): StaleVersionRebaseRetryHooks<TResult> => {
  const eligible =
    !isReclassification &&
    !options.rayenClinicalWriteGuard &&
    !options.requireAtomicCas &&
    !policy.requireAtomicCas &&
    !policy.remoteAuthorityFirst &&
    semanticChangedPaths.length > 0 &&
    !semanticChangedPaths.includes('*');
  if (!eligible) {
    return {};
  }

  const baseValuesAtPatchPaths = Object.fromEntries(
    semanticChangedPaths.map(path => [path, getValueAtPath(baseRecord, path)])
  );

  return {
    retryRemoteWriteOnStaleVersion: freshRemoteRecord =>
      updateRecordPartialToFirestore(
        date,
        policy.remoteAuthorityPatch,
        freshRemoteRecord.lastUpdated,
        buildGuardedDailyRecordRemoteWriteOptions({
          options,
          policy,
          syncContract: buildDailyRecordSyncContract(validatedRecord, {
            expectedVersion: freshRemoteRecord.lastUpdated,
            changedPaths: semanticChangedPaths,
          }),
          isReclassification,
        })
      ) as Promise<TResult | void>,
    canRebaseStaleVersionConflict: freshRemoteRecord =>
      hasSameValuesAtPaths(freshRemoteRecord, baseValuesAtPatchPaths),
  };
};

/**
 * Ejecuta el reintento re-basado si aplica. Devuelve `null` cuando el error no
 * es un conflicto de versión rescatable (el caller debe relanzarlo); si el
 * reintento corre, sus propios errores se propagan hacia la recuperación
 * normal del caller.
 */
export const attemptStaleVersionRebaseRetry = async <TResult>({
  writeError,
  date,
  hooks,
  readRemoteConfirmedRecord,
}: {
  writeError: unknown;
  date: string;
  hooks: StaleVersionRebaseRetryHooks<TResult>;
  readRemoteConfirmedRecord?: () => Promise<DailyRecord | null>;
}): Promise<{ result: TResult | void } | null> => {
  if (
    !hooks.retryRemoteWriteOnStaleVersion ||
    !hooks.canRebaseStaleVersionConflict ||
    !readRemoteConfirmedRecord ||
    !(writeError instanceof Error) ||
    writeError.name !== 'ConcurrencyError'
  ) {
    return null;
  }

  const freshRemoteRecord = await readRemoteConfirmedRecord();
  if (
    !isValidRemoteAuthorityRecord(freshRemoteRecord, date) ||
    !hooks.canRebaseStaleVersionConflict(freshRemoteRecord)
  ) {
    return null;
  }

  return { result: await hooks.retryRemoteWriteOnStaleVersion(freshRemoteRecord) };
};
