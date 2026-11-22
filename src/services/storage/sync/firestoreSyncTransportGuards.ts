import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import {
  ConcurrencyError,
  createDailyRecordBaseReviewError,
} from '@/services/storage/syncErrorCatalog';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import { normalizeChangedPaths } from '@/services/repositories/conflictResolutionUtils';
import { evaluateDailyRecordConflictPostMergeInvariants } from '@/services/repositories/dailyRecordConflictPostMergeInvariantChecker';
import {
  applyDailyRecordClinicalConsistencyCheck,
  recordClinicalConsistencyTelemetry,
} from '@/services/repositories/dailyRecordClinicalConsistencyCheck';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import { nursingHandoffPaths } from './nursingHandoffTasks';
import {
  resolveOptionalBaseRevision,
  resolveRecordBaseRevision,
  UNKNOWN_SERVER_VERSION,
} from './syncTaskContractPolicy';

const STRICT_REMOTE_DRIFT_TOLERANCE_MS = 0;

export const runE2ESyncTransport = async (task: SyncTask): Promise<boolean> => {
  if (!isE2ERuntimeEnabled() || typeof window === 'undefined') return false;
  const handler = (
    window as Window & {
      __HHR_E2E_RUN_SYNC_TASK__?: (task: SyncTask) => Promise<void>;
    }
  ).__HHR_E2E_RUN_SYNC_TASK__;
  if (!handler) return false;
  await handler(task);
  return true;
};

/**
 * Blocks writes when the remote record is newer than the local copy. Without
 * client/tab metadata, the outbox cannot prove a rapid write came from the same
 * session, so even short drifts must be treated as real concurrency.
 */
const toMillis = (value: string | undefined): number => {
  if (!value) return 0;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

export const getRemoteLastUpdated = (remoteData: Record<string, unknown>): string | undefined =>
  remoteData?.lastUpdated instanceof Object && 'toDate' in remoteData.lastUpdated
    ? (remoteData.lastUpdated as { toDate: () => Date }).toDate().toISOString()
    : typeof remoteData?.lastUpdated === 'string'
      ? remoteData.lastUpdated
      : undefined;

export const assertSyncQueueConcurrency = (
  record: DailyRecord,
  remoteLastUpdated: string | undefined
): void => {
  const localLastUpdated = record.lastUpdated;
  if (!localLastUpdated) return;
  if (!remoteLastUpdated) return;

  const drift = toMillis(remoteLastUpdated) - toMillis(localLastUpdated);
  if (drift > STRICT_REMOTE_DRIFT_TOLERANCE_MS) {
    throw new ConcurrencyError(
      `Sync queue: remote record for ${record.date} is newer ` +
        `(remote=${remoteLastUpdated}, local=${localLastUpdated}, drift=${Math.round(drift / 1000)}s). ` +
        `Skipping stale write to prevent data loss.`
    );
  }
};

export const shouldRevalidateAgainstRemote = (
  remoteLastUpdated: string | undefined,
  expectedVersion: string | undefined
): boolean => {
  if (!remoteLastUpdated || !expectedVersion) return false;
  return toMillis(remoteLastUpdated) > toMillis(expectedVersion);
};

export const isWholeRecordTask = (task: SyncTask): boolean => {
  const paths = normalizeChangedPaths(task.syncContract?.changedPaths);
  return !paths.length || paths.includes('*');
};

export const assertKnownWholeRecordBase = (
  task: SyncTask,
  remoteData?: Record<string, unknown>
): void => {
  if (!isWholeRecordTask(task)) return;

  const expectedVersion = task.syncContract?.expectedVersion;
  let knownBase = expectedVersion !== UNKNOWN_SERVER_VERSION;
  if (knownBase && remoteData) {
    const revision = resolveOptionalBaseRevision(task.syncContract?.baseRevision);
    const remoteRevision = Number(
      (remoteData.meta as { revision?: unknown } | undefined)?.revision
    );
    const currentRevision =
      Number.isFinite(remoteRevision) && remoteRevision >= 0 ? remoteRevision : 0;
    const expectedMillis = Date.parse(expectedVersion ?? '');
    const matchingVersion =
      Number.isFinite(expectedMillis) &&
      expectedMillis === Date.parse(getRemoteLastUpdated(remoteData) ?? '');
    knownBase =
      revision !== undefined
        ? revision === currentRevision && (expectedVersion === undefined || matchingVersion)
        : matchingVersion;
  }
  if (!knownBase) {
    throw createDailyRecordBaseReviewError(
      'El censo cambió o su base no es verificable. Conservamos los cambios para revisión.'
    );
  }
};

export const assertNursingHandoffRecoveryBase = (
  task: SyncTask,
  remoteData: Record<string, unknown>,
  remoteLastUpdated: string | undefined
): void => {
  if (!task.nursingHandoffRecovery) return;
  // A released snapshot has no local projection to support a whole-day publish. Only its
  // nursing paths are replayed, against the exact original version, including equal-time revisions.
  const paths = nursingHandoffPaths(task);
  const base = task.syncContract;
  if (
    !paths.length ||
    !base?.expectedVersion ||
    base.expectedVersion !== remoteLastUpdated ||
    (base.baseRevision !== undefined &&
      base.baseRevision !==
        resolveOptionalBaseRevision(
          (remoteData.meta as { revision?: unknown } | undefined)?.revision
        ))
  ) {
    throw new ConcurrencyError('El censo cambió. La entrega retenida se conserva para revisión.');
  }
};

export const prepareNursingHandoffRecoveryTask = (task: SyncTask): SyncTask => {
  if (!task.nursingHandoffRecovery) return task;
  const paths = nursingHandoffPaths(task);
  const mutationId = task.syncContract?.mutationId ?? task.opId;
  return {
    ...task,
    syncContract: {
      ...task.syncContract,
      changedPaths: paths,
      // A subset cannot acknowledge the other fields of a compacted/original mutation.
      mutationId:
        paths.length === task.syncContract?.changedPaths?.length
          ? mutationId
          : `${mutationId}:nursing-recovery`,
      mutationIds:
        paths.length === task.syncContract?.changedPaths?.length
          ? task.syncContract?.mutationIds
          : undefined,
    },
  };
};

export const mergeRevalidatedRecord = (
  remoteRecord: DailyRecord,
  record: DailyRecord,
  changedPaths: string[] | undefined
): DailyRecord => {
  const mergedRecord = resolveDailyRecordConflict(remoteRecord, record, {
    changedPaths,
  });
  const postMergeInvariants = evaluateDailyRecordConflictPostMergeInvariants({
    remote: remoteRecord,
    local: record,
    resolved: mergedRecord,
    context: {
      date: record.date,
      phase: 'sync_publish',
    },
  });

  if (postMergeInvariants.status === 'blocked') {
    throw new ConcurrencyError(
      `Sync queue: post-merge invariants blocked stale task for ${record.date}: ` +
        postMergeInvariants.violations.map(violation => violation.path).join(', ')
    );
  }

  const consistency = applyDailyRecordClinicalConsistencyCheck(postMergeInvariants.record, {
    date: record.date,
    phase: 'sync_publish',
  });
  recordClinicalConsistencyTelemetry(consistency);

  if (consistency.status === 'blocked') {
    throw new ConcurrencyError(
      `Sync queue: stale task for ${record.date} was revalidated but still has blocked clinical consistency.`
    );
  }

  return consistency.record;
};

export const buildFreshRebaseBase = (
  task: SyncTask,
  resolution: NonNullable<SyncTask['syncContract']>['resolution'],
  storedData: Record<string, unknown> | undefined,
  canRebasePatch: boolean | undefined,
  date: string
) =>
  !task.nursingHandoffRecovery && resolution === 'merged' && storedData && canRebasePatch
    ? {
        expectedVersion: getRemoteLastUpdated(storedData),
        baseRevision: resolveRecordBaseRevision(docToRecord(storedData, date)),
      }
    : undefined;
