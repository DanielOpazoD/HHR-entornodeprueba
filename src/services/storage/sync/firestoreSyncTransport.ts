import { getDoc } from 'firebase/firestore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type {
  SyncTransportPort,
  SyncTransportResult,
} from '@/services/storage/sync/syncQueuePorts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';
import { docToRecord, getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import {
  ConcurrencyError,
  createDailyRecordBaseReviewError,
} from '@/services/storage/syncErrorCatalog';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import {
  getValueAtPath,
  hasSameValuesAtPaths,
  normalizeChangedPaths,
} from '@/services/repositories/conflictResolutionUtils';
import { evaluateDailyRecordConflictPostMergeInvariants } from '@/services/repositories/dailyRecordConflictPostMergeInvariantChecker';
import {
  applyDailyRecordClinicalConsistencyCheck,
  recordClinicalConsistencyTelemetry,
} from '@/services/repositories/dailyRecordClinicalConsistencyCheck';
import {
  evaluateDailyRecordClinicalAuthority,
  recordClinicalAuthorityTelemetry,
  recordClinicalEpisodeIdCoverageTelemetry,
} from '@/services/repositories/dailyRecordClinicalAuthorityPolicy';
import { saveDailyRecordWithClinicalAuthorityCallable } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { recordSyncQueueTruthSelectionTelemetry } from '@/services/storage/sync/syncQueueTelemetryController';
import {
  assertNoSamePathRemoteMutation,
  assertUnchangedReplayPatchBase,
  hasRemoteAppliedMutation,
  withOwnEarlierWriteAsBase,
} from '@/services/storage/sync/firestoreSyncConflictPolicy';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import type { DetachedOccupantWork } from './dayTaskOccupantDetach';
import { nursingHandoffPaths } from './nursingHandoffTasks';
import {
  holdOutPlainDayFieldsChangedElsewhere,
  keepPlainDayFieldsHeld,
  plainDayFieldReplayPaths,
  replayPlainDayFields,
  withoutUnchangedPlainDayFields,
  type PlainDayFieldsHeldOut,
} from './plainDayFieldReplay';
import {
  resolveOptionalBaseRevision,
  resolveRecordBaseRevision,
  UNKNOWN_SERVER_VERSION,
} from './syncTaskContractPolicy';
import { applyPatches } from '@/utils/patchUtils';

const STRICT_REMOTE_DRIFT_TOLERANCE_MS = 0;

const runE2ESyncTransport = async (task: SyncTask): Promise<boolean> => {
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

const getRemoteLastUpdated = (remoteData: Record<string, unknown>): string | undefined =>
  remoteData?.lastUpdated instanceof Object && 'toDate' in remoteData.lastUpdated
    ? (remoteData.lastUpdated as { toDate: () => Date }).toDate().toISOString()
    : typeof remoteData?.lastUpdated === 'string'
      ? remoteData.lastUpdated
      : undefined;

const assertSyncQueueConcurrency = (
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

const shouldRevalidateAgainstRemote = (
  remoteLastUpdated: string | undefined,
  expectedVersion: string | undefined
): boolean => {
  if (!remoteLastUpdated || !expectedVersion) return false;
  return toMillis(remoteLastUpdated) > toMillis(expectedVersion);
};

const isWholeRecordTask = (task: SyncTask): boolean => {
  const paths = normalizeChangedPaths(task.syncContract?.changedPaths);
  return !paths.length || paths.includes('*');
};

const assertKnownWholeRecordBase = (task: SyncTask, remoteData?: Record<string, unknown>): void => {
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

interface ResolvedSyncRecordForTask {
  record: DailyRecord;
  resolution: NonNullable<SyncTask['syncContract']>['resolution'];
  acceptedVersion?: string;
  /** Stored day this resolution read; undefined when the day does not exist yet. */
  storedData?: Record<string, unknown>;
  /** Eligibility checked against the original task, before stripping notes or detached edits. */
  canRebasePatch?: boolean;
  /** Edits left out because their bed or crib now holds another patient or episode. */
  detached?: DetachedOccupantWork;
  /** Plain day fields another computer changed, left out and kept held in the day task. */
  heldOut?: PlainDayFieldsHeldOut;
}

/** The day task's occupant and replay checks, loaded with the outbox. */
type ReplayChecks = Pick<
  typeof import('./dexieDailyRecordOutbox'),
  | 'detachStaleOccupantPaths'
  | 'hasOtherOccupantInUntouchedBed'
  | 'hasUnchangedPatchBase'
  | 'keepStoredNoteFields'
>;

const resolveRecordForSyncTask = async (
  queuedTask: SyncTask,
  queuedRecord: DailyRecord,
  runtime: FirestoreServiceRuntimePort,
  checks?: ReplayChecks
): Promise<ResolvedSyncRecordForTask> => {
  let task = queuedTask;
  let record = queuedRecord;
  const docRef = getRecordDocRef(record.date, runtime);
  const remoteSnap = await getDoc(docRef);
  if (!remoteSnap.exists()) {
    if (task.nursingHandoffRecovery)
      throw new ConcurrencyError('La entrega retenida requiere revisar el censo que falta.');
    assertKnownWholeRecordBase(task);
    return {
      record: checks?.keepStoredNoteFields(task, record, undefined) ?? record,
      resolution: 'accepted',
      acceptedVersion: record.lastUpdated,
    };
  }

  const remoteData = remoteSnap.data() as Record<string, unknown>;
  const remoteLastUpdated = getRemoteLastUpdated(remoteData);
  // An earlier edit of this task the server saved while its answer was lost is this task's base.
  const ownTask = withOwnEarlierWriteAsBase(task, remoteData);
  task = ownTask;
  const contract = task.syncContract;
  const compacted = contract?.mutationIds?.some(id => id !== contract.mutationId);
  const changedPaths = contract?.changedPaths ?? [];
  const allCompactedValuesApplied =
    changedPaths.length > 0 &&
    !changedPaths.includes('*') &&
    hasSameValuesAtPaths(
      remoteData,
      Object.fromEntries(changedPaths.map(path => [path, getValueAtPath(record, path)]))
    );
  const alreadyApplied = (
    detached?: DetachedOccupantWork,
    heldOut?: PlainDayFieldsHeldOut
  ): ResolvedSyncRecordForTask => ({
    record: docToRecord(remoteData, record.date),
    resolution: 'already_applied',
    acceptedVersion: remoteLastUpdated,
    storedData: remoteData,
    detached,
    heldOut,
  });
  // Edits written for a patient who left the bed or crib never reach the next occupant. They are
  // rebuilt even when the rest already landed, since the ACK that kept them may have rolled back.
  const detached =
    checks?.detachStaleOccupantPaths(task, record, docToRecord(remoteData, record.date)) ??
    undefined;
  if (
    hasRemoteAppliedMutation(task, remoteData.meta as Record<string, unknown> | undefined) &&
    (!compacted || allCompactedValuesApplied)
  ) {
    return alreadyApplied(detached);
  }
  if (task.nursingHandoffRecovery) {
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
    )
      throw new ConcurrencyError('El censo cambió. La entrega retenida se conserva para revisión.');
  }
  // A confirmed mutation can be acknowledged above. An opaque legacy snapshot without a
  // trustworthy base cannot prove what it owns, so keep it for review instead of replaying it.
  assertKnownWholeRecordBase(task, remoteData);
  if (detached) {
    ({ task, record } = detached);
    // Nothing else to publish: the stored day stays as it is.
    if (!task.syncContract?.changedPaths?.length) return alreadyApplied(detached);
  }

  const remoteRecord = docToRecord(remoteData, record.date);
  // Never with edits detached for another occupant: the whole write then waits, as before.
  const heldOut = detached
    ? undefined
    : holdOutPlainDayFieldsChangedElsewhere(task, remoteData, remoteRecord, record);
  if (heldOut) ({ task, record } = heldOut);
  const applied = assertUnchangedReplayPatchBase(task, remoteData, remoteRecord, record, ownTask);
  if (applied.length) {
    // The server already holds these fields as the edit wants them, a lost ACK included: the
    // task ends as sent when nothing else is left, and those fields keep the server's own text.
    if (
      normalizeChangedPaths(task.syncContract?.changedPaths).every(path => applied.includes(path))
    )
      return alreadyApplied(detached, heldOut);
    record = applyPatches(
      record,
      Object.fromEntries(
        applied.map(path => [path, getValueAtPath(remoteRecord, path)])
      ) as DailyRecordPatch
    );
  }
  // Its write compares each field with its base inside its transaction (replayPlainDayFields).
  if (plainDayFieldReplayPaths(task))
    return {
      record,
      resolution: 'accepted',
      acceptedVersion: remoteLastUpdated,
      storedData: remoteData,
      heldOut,
    };
  const rebasedPart = withoutUnchangedPlainDayFields(ownTask, remoteRecord, queuedRecord);
  // Without the fields another computer changed, the rest was just checked field by field.
  const canRebasePatch =
    !detached &&
    (Boolean(heldOut) ||
      Boolean(
        rebasedPart && checks?.hasUnchangedPatchBase(rebasedPart, remoteRecord, queuedRecord)
      ));
  if (task.nursingHandoffRecovery) {
    record = resolveDailyRecordConflict(remoteRecord, record, {
      changedPaths: task.syncContract?.changedPaths,
    });
  }
  // Note fields outside this write's changed paths keep the stored day's values, before either
  // acceptance or conflict merging.
  record = checks?.keepStoredNoteFields(task, record, remoteRecord) ?? record;
  if (
    !detached &&
    !shouldRevalidateAgainstRemote(remoteLastUpdated, task.syncContract?.expectedVersion) &&
    (!canRebasePatch ||
      contract?.baseRevision === undefined ||
      contract.baseRevision === resolveRecordBaseRevision(remoteRecord)) &&
    !checks?.hasOtherOccupantInUntouchedBed(task, record, remoteRecord)
  ) {
    assertSyncQueueConcurrency(record, remoteLastUpdated);
    return {
      record,
      resolution: 'accepted',
      acceptedVersion: record.lastUpdated,
      storedData: remoteData,
      heldOut,
    };
  }

  if (!canRebasePatch)
    assertNoSamePathRemoteMutation(task, remoteData, remoteRecord, record, applied);
  const mergedRecord = resolveDailyRecordConflict(remoteRecord, record, {
    changedPaths: task.syncContract?.changedPaths,
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

  return {
    record: consistency.record,
    resolution: 'merged',
    acceptedVersion: consistency.record.lastUpdated,
    storedData: remoteData,
    detached,
    canRebasePatch,
    heldOut,
  };
};

const assertResolvedClinicalAuthority = (
  task: SyncTask,
  resolved: ResolvedSyncRecordForTask
): void => {
  const authority = evaluateDailyRecordClinicalAuthority(resolved.record, {
    date: resolved.record.date,
    phase: 'sync_publish',
  });
  recordClinicalAuthorityTelemetry(authority);
  recordClinicalEpisodeIdCoverageTelemetry(resolved.record, {
    date: resolved.record.date,
    phase: 'sync_publish',
  });

  if (authority.status === 'blocked') {
    recordSyncQueueTruthSelectionTelemetry(task, {
      resolution: 'blocked',
      acceptedVersion: resolved.acceptedVersion,
      selectedTruth: 'blocked_before_publish',
    });
    throw new ConcurrencyError(
      `Sync queue: clinical authority blocked write for ${resolved.record.date}.`
    );
  }
};

const syncDailyRecord = async (
  task: SyncTask,
  record: DailyRecord,
  runtime: FirestoreServiceRuntimePort,
  assertCanPublish?: () => void
): Promise<SyncTransportResult | void> => {
  if (await runE2ESyncTransport(task)) return;
  if (task.nursingHandoffRecovery) {
    const paths = nursingHandoffPaths(task);
    const mutationId = task.syncContract?.mutationId ?? task.opId;
    task = {
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
  }
  const occupants: ReplayChecks = await import('./dexieDailyRecordOutbox');
  let detached: DetachedOccupantWork | undefined;
  let heldOut: PlainDayFieldsHeldOut | undefined;
  const result = await measureRepositoryOperation(
    'syncQueue.writeDailyRecord',
    async (): Promise<SyncTransportResult> => {
      const resolved = await resolveRecordForSyncTask(task, record, runtime, occupants);
      ({ detached, heldOut } = resolved);
      // The part this replay publishes: never the fields left out of it.
      const publishTask = heldOut?.task ?? detached?.task ?? task;
      if (resolved.resolution === 'already_applied') {
        recordSyncQueueTruthSelectionTelemetry(task, {
          resolution: resolved.resolution,
          acceptedVersion: resolved.acceptedVersion,
          selectedTruth: 'remote_already_applied',
        });
        return { authoritativeRecord: resolved.record };
      }
      const recordToWrite = resolved.record;
      const plainPaths = plainDayFieldReplayPaths(publishTask);
      if (plainPaths && resolved.storedData) {
        const replayed = await replayPlainDayFields(
          publishTask,
          recordToWrite,
          plainPaths,
          runtime,
          assertCanPublish
        );
        recordSyncQueueTruthSelectionTelemetry(task, {
          resolution: resolved.resolution,
          acceptedVersion: replayed.authoritativeRecord.lastUpdated,
          selectedTruth: 'legacy_direct_publish',
        });
        return replayed;
      }

      assertResolvedClinicalAuthority(task, resolved);

      const freshBase =
        !task.nursingHandoffRecovery &&
        resolved.resolution === 'merged' &&
        resolved.storedData &&
        resolved.canRebasePatch
          ? {
              expectedVersion: getRemoteLastUpdated(resolved.storedData),
              baseRevision: resolveRecordBaseRevision(
                docToRecord(resolved.storedData, recordToWrite.date)
              ),
            }
          : undefined;
      assertCanPublish?.();
      const response = await saveDailyRecordWithClinicalAuthorityCallable(
        {
          date: recordToWrite.date,
          record: recordToWrite,
          expectedLastUpdated: freshBase?.expectedVersion ?? task.syncContract?.expectedVersion,
          mode: 'enforced',
          origin: task.origin,
          syncContract: { ...publishTask.syncContract, ...freshBase },
        },
        assertCanPublish
      ).catch(error => {
        if (
          error instanceof ConcurrencyError &&
          error.reason === 'version_mismatch' &&
          isWholeRecordTask(task)
        ) {
          throw createDailyRecordBaseReviewError(error.message);
        }
        throw error;
      });
      const authoritativeRecord = response.recordState?.record;
      if (
        !authoritativeRecord ||
        authoritativeRecord.date !== recordToWrite.date ||
        authoritativeRecord.lastUpdated !== response.recordState?.lastUpdated
      ) {
        throw new ConcurrencyError(
          `Sync queue: authority omitted the committed record for ${recordToWrite.date}.`
        );
      }
      recordSyncQueueTruthSelectionTelemetry(task, {
        resolution: resolved.resolution,
        acceptedVersion: authoritativeRecord.lastUpdated,
        acceptedRevision: response?.revision,
        selectedTruth: 'authority_intent_invariants',
      });
      return { authoritativeRecord };
    },
    { thresholdMs: 180, context: record.date }
  );
  if (!detached && !heldOut) return result;
  // The conflicts are durable: the store writes them with this task's completion.
  return {
    ...result,
    detachedConflicts: detached?.conflicts,
    heldTask:
      heldOut && keepPlainDayFieldsHeld(task, record, heldOut.paths, result.authoritativeRecord),
  };
};

export const createFirestoreSyncTransport = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): SyncTransportPort => ({
  async run(task: SyncTask, assertCanPublish?: () => void) {
    switch (task.type) {
      case 'ARCHIVE_CUDYR':
        await import('./cudyrArchiveTransport').then(({ replayCudyrArchive }) =>
          replayCudyrArchive(task, runtime)
        );
        return;
      case 'UPDATE_DAILY_RECORD':
        return syncDailyRecord(task, task.payload as DailyRecord, runtime, assertCanPublish);
      default:
        throw new Error(`[SyncQueue] Unsupported task type: ${String(task.type)}`);
    }
  },
});
