import type { AuthoringSession } from '@/services/session/authoringSession';
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
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  buildRecoveryTaskMeta,
  resolveRetryOrigin,
} from '@/services/repositories/dailyRecordWriteRecoveryController';
import { resolveConcurrencyRemoteWriteRecovery } from '@/services/repositories/dailyRecordWriteConcurrencyRecoveryController';
import {
  pendingWriteOutcome,
  settleWriteResult,
  unrecoverableWriteOutcome,
  type RemoteWriteStep,
} from '@/services/repositories/dailyRecordWriteState';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { dailyRecordWriteLogger } from '@/services/repositories/repositoryLoggers';
import { isSavedByQueueRouteError } from '@/services/storage/syncErrorCatalog';

const isConcurrencyError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConcurrencyError';

const queueRecoveryTask = async (
  record: DailyRecord,
  meta: NonNullable<Parameters<typeof queueDailyRecordSyncTaskWithLocalRecord>[1]>,
  authoringSession: AuthoringSession
): Promise<boolean> => {
  const result = await queueDailyRecordSyncTaskWithLocalRecord(record, meta, { authoringSession });
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

export const runRemoteSaveIntegrityCheck = async (
  date: string,
  record: DailyRecord
): Promise<void> => {
  if (!isFirestoreEnabled()) return;
  try {
    await assertRemoteSaveCompatibility(date, record);
  } catch (error) {
    if (error instanceof DataRegressionError || error instanceof VersionMismatchError) throw error;
    dailyRecordWriteLogger.warn('Could not perform integrity check, proceeding anyway', error);
  }
};

const QUEUED_MESSAGE =
  'Los cambios se guardaron localmente y quedaron pendientes de sincronización.';
const QUEUE_BACKPRESSURE_MESSAGE =
  'Los cambios se guardaron localmente, pero la cola de sincronización alcanzó su límite operativo. Reintenta cuando la conectividad se estabilice o revisa el estado de sincronización.';
const REMOTE_UNAVAILABLE_MESSAGE =
  'Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.';

interface RemoteWriteRecoveryInput {
  date: string;
  record: DailyRecord;
  changedPaths: string[];
  error: unknown;
  /** The write's result when the remote step failed. */
  current: DailyRecordWriteResult;
  authoringSession: AuthoringSession;
  expectedVersion?: string;
  allowConflictAutoMerge?: boolean;
  /** The write's own outbox task already holds it: recovery never stores a second copy. */
  localWriteAlreadyQueued?: boolean;
}

/** The next result of a write whose remote step failed. */
export const resolveRemoteWriteRecovery = async ({
  date,
  record,
  changedPaths,
  error,
  current,
  authoringSession,
  expectedVersion,
  allowConflictAutoMerge = true,
  localWriteAlreadyQueued = false,
}: RemoteWriteRecoveryInput): Promise<RemoteWriteStep> => {
  if (error instanceof DataRegressionError || error instanceof VersionMismatchError) {
    return {
      result: settleWriteResult(
        current,
        { state: 'not_saved', reason: 'blocked' },
        { userSafeMessage: error.message, blockingError: error }
      ),
      next: 'return',
    };
  }

  const ensureQueued = async () =>
    localWriteAlreadyQueued ||
    (await queueRecoveryTask(
      record,
      buildRecoveryTaskMeta(changedPaths, resolveRetryOrigin(changedPaths), expectedVersion),
      authoringSession
    ));
  const queueFull = (): RemoteWriteStep => ({
    result: settleWriteResult(current, unrecoverableWriteOutcome(current), {
      userSafeMessage: QUEUE_BACKPRESSURE_MESSAGE,
    }),
    next: 'continue',
  });

  // Not a conflict: nothing remote to merge. The day's queue task saves this edit with its base
  // version, and that task alone, so it waits there without a second copy or a notice.
  if (isSavedByQueueRouteError(error)) {
    if (!(await ensureQueued())) return queueFull();
    return {
      result: settleWriteResult(
        current,
        { state: 'local', cause: 'queue_route' },
        { userSafeMessage: QUEUED_MESSAGE }
      ),
      next: 'continue',
    };
  }

  if (isConcurrencyError(error)) {
    return resolveConcurrencyRemoteWriteRecovery(
      date,
      record,
      changedPaths,
      error,
      current,
      authoringSession,
      allowConflictAutoMerge
    );
  }

  if (isRetryableSyncError(error)) {
    if (!(await ensureQueued())) return queueFull();
    return {
      result: settleWriteResult(current, pendingWriteOutcome(current, 'retrying'), {
        userSafeMessage: QUEUED_MESSAGE,
      }),
      next: 'continue',
    };
  }

  return {
    result: settleWriteResult(current, unrecoverableWriteOutcome(current), {
      userSafeMessage: REMOTE_UNAVAILABLE_MESSAGE,
    }),
    next: 'continue',
  };
};
