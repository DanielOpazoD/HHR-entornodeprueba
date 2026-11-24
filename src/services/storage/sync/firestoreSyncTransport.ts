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
import type { StrippedOccupantWork } from './dayTaskReplayGuard';
import {
  plainDayFieldReplayPaths,
  replayPlainDayFields,
  withoutUnchangedPlainDayFields,
} from './plainDayFieldReplay';
import { resolveRecordBaseRevision } from './syncTaskContractPolicy';
import { applyPatches } from '@/utils/patchUtils';
import {
  assertKnownWholeRecordBase,
  assertNursingHandoffRecoveryBase,
  assertSyncQueueConcurrency,
  buildFreshRebaseBase,
  getRemoteLastUpdated,
  isWholeRecordTask,
  mergeRevalidatedRecord,
  prepareNursingHandoffRecoveryTask,
  runE2ESyncTransport,
  shouldRevalidateAgainstRemote,
} from './firestoreSyncTransportGuards';

interface ResolvedSyncRecordForTask {
  record: DailyRecord;
  resolution: NonNullable<SyncTask['syncContract']>['resolution'];
  acceptedVersion?: string;
  /** Stored day this resolution read; undefined when the day does not exist yet. */
  storedData?: Record<string, unknown>;
  /** Eligibility checked against the original task, before stripping notes or stale occupant edits. */
  canRebasePatch?: boolean;
  /** Task narrowed after stripping edits for a bed or crib whose occupant changed. */
  stripped?: StrippedOccupantWork;
}

/** The day task's occupant and replay checks, loaded with the outbox. */
type ReplayChecks = Pick<
  typeof import('./dexieDailyRecordOutbox'),
  | 'stripStaleOccupantPaths'
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
  const alreadyApplied = (): ResolvedSyncRecordForTask => ({
    record: docToRecord(remoteData, record.date),
    resolution: 'already_applied',
    acceptedVersion: remoteLastUpdated,
    storedData: remoteData,
  });
  // Edits written for a patient who left the bed or crib never reach the next occupant (ID-05).
  const stripped =
    checks?.stripStaleOccupantPaths(task, record, docToRecord(remoteData, record.date)) ??
    undefined;
  if (
    hasRemoteAppliedMutation(task, remoteData.meta as Record<string, unknown> | undefined) &&
    (!compacted || allCompactedValuesApplied)
  ) {
    return alreadyApplied();
  }
  assertNursingHandoffRecoveryBase(task, remoteData, remoteLastUpdated);
  // A confirmed mutation can be acknowledged above. An opaque legacy snapshot without a
  // trustworthy base cannot prove what it owns, so keep it for review instead of replaying it.
  assertKnownWholeRecordBase(task, remoteData);
  if (stripped) {
    ({ task, record } = stripped);
    // Nothing else to publish: the stored day stays as it is.
    if (!task.syncContract?.changedPaths?.length) return alreadyApplied();
  }

  const remoteRecord = docToRecord(remoteData, record.date);
  const applied = assertUnchangedReplayPatchBase(task, remoteData, remoteRecord, record, ownTask);
  if (applied.length) {
    // The server already holds these fields as the edit wants them, a lost ACK included: the
    // task ends as sent when nothing else is left, and those fields keep the server's own text.
    if (
      normalizeChangedPaths(task.syncContract?.changedPaths).every(path => applied.includes(path))
    )
      return alreadyApplied();
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
    };
  const rebasedPart = withoutUnchangedPlainDayFields(ownTask, remoteRecord, queuedRecord);
  const canRebasePatch =
    !stripped &&
    Boolean(rebasedPart && checks?.hasUnchangedPatchBase(rebasedPart, remoteRecord, queuedRecord));
  if (task.nursingHandoffRecovery) {
    record = resolveDailyRecordConflict(remoteRecord, record, {
      changedPaths: task.syncContract?.changedPaths,
    });
  }
  // Note fields outside this write's changed paths keep the stored day's values, before either
  // acceptance or conflict merging.
  record = checks?.keepStoredNoteFields(task, record, remoteRecord) ?? record;
  if (
    !stripped &&
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
    };
  }

  if (!canRebasePatch)
    assertNoSamePathRemoteMutation(task, remoteData, remoteRecord, record, applied);
  const revalidatedRecord = mergeRevalidatedRecord(
    remoteRecord,
    record,
    task.syncContract?.changedPaths
  );

  return {
    record: revalidatedRecord,
    resolution: 'merged',
    acceptedVersion: revalidatedRecord.lastUpdated,
    storedData: remoteData,
    stripped,
    canRebasePatch,
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
  queuedTask: SyncTask,
  record: DailyRecord,
  runtime: FirestoreServiceRuntimePort,
  assertCanPublish?: () => void
): Promise<SyncTransportResult | void> => {
  if (await runE2ESyncTransport(queuedTask)) return;
  const task = prepareNursingHandoffRecoveryTask(queuedTask);
  const occupants: ReplayChecks = await import('./dexieDailyRecordOutbox');
  return measureRepositoryOperation(
    'syncQueue.writeDailyRecord',
    async (): Promise<SyncTransportResult> => {
      const resolved = await resolveRecordForSyncTask(task, record, runtime, occupants);
      const publishTask = resolved.stripped?.task ?? task;
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

      const freshBase = buildFreshRebaseBase(
        task,
        resolved.resolution,
        resolved.storedData,
        resolved.canRebasePatch,
        recordToWrite.date
      );
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
