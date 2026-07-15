import { CURRENT_SCHEMA_VERSION } from '@/constants/version';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { findPatientErasures } from '@/services/repositories/dailyRecordErasureGuard';
import {
  isRetryableSyncError,
  queueDailyRecordSyncTaskWithLocalRecord,
} from '@/services/storage/sync';
import {
  calculateDensity,
  checkRegression,
  DataRegressionError,
  VersionMismatchError,
} from '@/utils/integrityGuard';
import type { DailyRecordConflictSummary } from '@/services/repositories/contracts/dailyRecordConsistency';
import type { RemoteWriteRecoveryResult } from '@/services/repositories/contracts/dailyRecordWriteRecoveryResult';
import {
  buildDailyRecordConflictSummary,
  buildRecoveryTaskMeta,
  resolveEffectiveChangedPaths,
  resolveRetryOrigin,
} from '@/services/repositories/dailyRecordWriteRecoveryController';
import {
  resolveQueuedRetryRecoveryResult,
  resolveRemoteUnavailableRecoveryResult,
} from '@/services/repositories/dailyRecordRemoteRecoveryController';
import { resolveBlockedRemoteWriteRecovery } from '@/services/repositories/dailyRecordWriteBlockingRecoveryController';
import { resolveConcurrencyRemoteWriteRecovery } from '@/services/repositories/dailyRecordWriteConcurrencyRecoveryController';

const isConcurrencyError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConcurrencyError';

const queueRecoveryTask = async (
  record: DailyRecord,
  meta: NonNullable<Parameters<typeof queueDailyRecordSyncTaskWithLocalRecord>[1]>
): Promise<boolean> => {
  const result = await queueDailyRecordSyncTaskWithLocalRecord(record, meta);
  return result.accepted;
};

/**
 * Throws DataRegressionError when the cloud record holds a patient that the local copy dropped
 * without a matching movement. Pure (no I/O) so it can run both in the pre-write integrity check
 * and INSIDE the save transaction as an atomic backstop.
 */
export const assertNoPatientErasures = (
  remoteRecord: DailyRecord,
  localRecord: DailyRecord
): void => {
  const erasures = findPatientErasures(remoteRecord, localRecord);
  if (erasures.length > 0) {
    const detail = erasures.map(e => `${e.bedId} (${e.remotePatientName})`).join(', ');
    throw new DataRegressionError(
      `La cama ${detail} tiene un paciente en la nube pero está vacía en la copia local. El guardado fue bloqueado para evitar pérdida de datos.`,
      calculateDensity(localRecord),
      calculateDensity(remoteRecord)
    );
  }
};

export const assertRemoteSaveCompatibility = async (
  date: string,
  record: DailyRecord
): Promise<void> => {
  const remoteRecord = await getRecordFromFirestore(date);
  if (!remoteRecord) return;

  const remoteVersion = remoteRecord.schemaVersion || 0;
  if (remoteVersion > CURRENT_SCHEMA_VERSION) {
    throw new VersionMismatchError(
      `Tu aplicación está desactualizada (v${CURRENT_SCHEMA_VERSION}) y el registro en la nube usa el nuevo formato v${remoteVersion}.`
    );
  }

  const { isSuspicious, dropPercentage } = checkRegression(remoteRecord, record);
  if (isSuspicious) {
    throw new DataRegressionError(
      `Se detectó una pérdida masiva de datos (${dropPercentage.toFixed(1)}%). El guardado fue bloqueado.`,
      calculateDensity(record),
      calculateDensity(remoteRecord)
    );
  }

  assertNoPatientErasures(remoteRecord, record);
};

export const queueRetryForRecord = async (record: DailyRecord): Promise<boolean> => {
  return queueRecoveryTask(record, {
    contexts: ['clinical', 'staffing', 'movements', 'handoff', 'metadata'],
    origin: 'full_save_retry',
    syncContract: {
      expectedVersion: record.lastUpdated,
      changedPaths: ['*'],
    },
  });
};

export const shouldQueueRetryableError = (error: unknown): boolean => isRetryableSyncError(error);

export const resolveRemoteWriteRecovery = async (
  date: string,
  record: DailyRecord,
  changedPaths: string[],
  error: unknown,
  expectedVersion?: string,
  allowConflictAutoMerge: boolean = true
): Promise<RemoteWriteRecoveryResult> => {
  const effectiveChangedPaths = resolveEffectiveChangedPaths(changedPaths);
  const conflictSummary = (kind: DailyRecordConflictSummary['kind'], message: string) =>
    buildDailyRecordConflictSummary(record.lastUpdated, effectiveChangedPaths, kind, message);

  const blockedRecovery = resolveBlockedRemoteWriteRecovery(error, conflictSummary);
  if (blockedRecovery) {
    return blockedRecovery;
  }

  if (isConcurrencyError(error)) {
    return resolveConcurrencyRemoteWriteRecovery(
      date,
      record,
      changedPaths,
      error,
      conflictSummary,
      allowConflictAutoMerge
    );
  }

  if (shouldQueueRetryableError(error)) {
    const queued = await queueRecoveryTask(
      record,
      buildRecoveryTaskMeta(changedPaths, resolveRetryOrigin(changedPaths), expectedVersion)
    );
    return resolveQueuedRetryRecoveryResult(
      queued,
      conflictSummary(
        'remote_unavailable',
        queued
          ? 'El guardado remoto falló y se programó un reintento automático.'
          : 'La cola de sincronización alcanzó su límite operativo antes de programar el reintento.'
      )
    );
  }

  return resolveRemoteUnavailableRecoveryResult(
    conflictSummary(
      'remote_unavailable',
      'El guardado remoto falló sin una ruta segura de recuperación automática.'
    )
  );
};
