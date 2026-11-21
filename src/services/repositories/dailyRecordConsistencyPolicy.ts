import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  createConsistencyMetadata,
  type DailyRecordConflictSummary,
  type DailyRecordConsistencyMetadata,
  type DailyRecordReadConsistencyState,
  type DailyRecordSourceOfTruth,
} from '@/services/repositories/contracts/dailyRecordConsistency';

type RemoteAvailability = 'resolved' | 'missing' | 'unavailable' | 'not_requested';

interface ResolveReadConsistencyInput {
  localRecord: DailyRecord | null;
  remoteRecord: DailyRecord | null;
  selectedRecord: DailyRecord | null;
  remoteAvailability: RemoteAvailability;
  repairApplied?: boolean;
}

interface ResolveReadConsistencyResult extends DailyRecordConsistencyMetadata<DailyRecordReadConsistencyState> {
  shouldHydrateLocal: boolean;
}

const buildConflictSummary = (
  kind: DailyRecordConflictSummary['kind'],
  sourceOfTruth: DailyRecordSourceOfTruth,
  localRecord: DailyRecord | null,
  remoteRecord: DailyRecord | null,
  changedPaths?: string[],
  message?: string
): DailyRecordConflictSummary => ({
  kind,
  sourceOfTruth,
  localTimestamp: localRecord?.lastUpdated,
  remoteTimestamp: remoteRecord?.lastUpdated,
  changedPaths,
  message,
});

export const toRecordTimestamp = (value: string | undefined): number => {
  if (!value) return 0;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
};

const isLocalNewer = (localRecord: DailyRecord | null, remoteRecord: DailyRecord | null): boolean =>
  Boolean(
    localRecord &&
    remoteRecord &&
    toRecordTimestamp(localRecord.lastUpdated) > toRecordTimestamp(remoteRecord.lastUpdated)
  );

export const resolveDailyRecordReadConsistency = ({
  localRecord,
  remoteRecord,
  selectedRecord,
  remoteAvailability,
  repairApplied = false,
}: ResolveReadConsistencyInput): ResolveReadConsistencyResult => {
  if (!selectedRecord) {
    if (remoteAvailability === 'unavailable') {
      return {
        ...createConsistencyMetadata({
          consistencyState: 'unavailable',
          sourceOfTruth: 'none',
          retryability: 'automatic_retry',
          recoveryAction: 'defer_remote_sync',
          conflictSummary: buildConflictSummary(
            'remote_unavailable',
            'none',
            localRecord,
            remoteRecord,
            undefined,
            'No fue posible consultar la fuente remota.'
          ),
          observabilityTags: ['daily_record', 'read', 'remote_unavailable'],
          userSafeMessage: 'No se pudo consultar el registro remoto.',
          repairApplied: false,
        }),
        shouldHydrateLocal: false,
      };
    }

    return {
      ...createConsistencyMetadata({
        consistencyState: 'missing',
        sourceOfTruth: 'none',
        retryability: remoteAvailability === 'missing' ? 'manual_retry' : 'not_applicable',
        recoveryAction: remoteAvailability === 'missing' ? 'defer_remote_sync' : 'none',
        conflictSummary:
          remoteAvailability === 'missing'
            ? buildConflictSummary(
                'remote_missing',
                'none',
                localRecord,
                remoteRecord,
                undefined,
                'No existe registro local ni remoto para ese día.'
              )
            : null,
        observabilityTags: ['daily_record', 'read', 'missing'],
        userSafeMessage: 'No hay registro disponible para este día.',
        repairApplied: false,
      }),
      shouldHydrateLocal: false,
    };
  }

  if (selectedRecord === remoteRecord) {
    const shouldHydrateLocal =
      !localRecord ||
      toRecordTimestamp(remoteRecord?.lastUpdated) > toRecordTimestamp(localRecord.lastUpdated);
    return {
      ...createConsistencyMetadata({
        consistencyState: 'remote_authoritative',
        sourceOfTruth: 'remote',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: shouldHydrateLocal
          ? buildConflictSummary(
              'hydrated_from_remote',
              'remote',
              localRecord,
              remoteRecord,
              undefined,
              'La copia remota reemplazó la copia local desactualizada.'
            )
          : null,
        observabilityTags: ['daily_record', 'read', 'remote_authoritative'],
        userSafeMessage: undefined,
        repairApplied,
      }),
      shouldHydrateLocal,
    };
  }

  if (repairApplied) {
    return {
      ...createConsistencyMetadata({
        consistencyState: 'repaired_local',
        sourceOfTruth: 'local',
        retryability: remoteAvailability === 'unavailable' ? 'automatic_retry' : 'not_applicable',
        recoveryAction: remoteAvailability === 'unavailable' ? 'defer_remote_sync' : 'none',
        conflictSummary: buildConflictSummary(
          'repair_applied',
          'local',
          localRecord,
          remoteRecord,
          undefined,
          'La copia local requirió reparaciones de compatibilidad.'
        ),
        observabilityTags: ['daily_record', 'read', 'repair_applied'],
        userSafeMessage: 'Se usó una copia local reparada para continuar.',
        repairApplied: true,
      }),
      shouldHydrateLocal: false,
    };
  }

  if (remoteAvailability === 'unavailable') {
    return {
      ...createConsistencyMetadata({
        consistencyState: 'local_authoritative',
        sourceOfTruth: 'local',
        retryability: 'automatic_retry',
        recoveryAction: 'defer_remote_sync',
        conflictSummary: buildConflictSummary(
          'remote_unavailable',
          'local',
          localRecord,
          remoteRecord,
          undefined,
          'Se mantuvo la copia local porque la fuente remota no estuvo disponible.'
        ),
        observabilityTags: ['daily_record', 'read', 'local_authoritative'],
        userSafeMessage: 'Se mantuvo la copia local mientras se recupera la fuente remota.',
        repairApplied: false,
      }),
      shouldHydrateLocal: false,
    };
  }

  if (isLocalNewer(localRecord, remoteRecord)) {
    return {
      ...createConsistencyMetadata({
        consistencyState: 'local_authoritative',
        sourceOfTruth: 'local',
        retryability: 'automatic_retry',
        recoveryAction: 'defer_remote_sync',
        conflictSummary: buildConflictSummary(
          'remote_stale',
          'local',
          localRecord,
          remoteRecord,
          undefined,
          'La copia local es más reciente que la remota.'
        ),
        observabilityTags: ['daily_record', 'read', 'local_authoritative'],
        userSafeMessage: 'La copia local es más reciente y se mantuvo como referencia.',
        repairApplied: false,
      }),
      shouldHydrateLocal: false,
    };
  }

  return {
    ...createConsistencyMetadata({
      consistencyState: 'local_only',
      sourceOfTruth: 'local',
      retryability: 'not_applicable',
      recoveryAction: 'none',
      conflictSummary: null,
      observabilityTags: ['daily_record', 'read', 'local_only'],
      userSafeMessage: undefined,
      repairApplied: false,
    }),
    shouldHydrateLocal: false,
  };
};
