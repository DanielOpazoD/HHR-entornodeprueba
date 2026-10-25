import { deleteField, getDoc, runTransaction, type Transaction } from 'firebase/firestore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type {
  SyncTransportPort,
  SyncTransportResult,
} from '@/services/storage/sync/syncQueuePorts';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';
import {
  docToRecord,
  sanitizeForFirestore,
  getRecordDocRef,
} from '@/services/storage/firestore/firestoreShared';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { loadSpecialistMedicalHandoffClient } from '@/services/storage/firestore/firestoreRecordWrites';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import { findDetachedReviewEdits } from '@/services/repositories/conflictResolutionDetachedEdits';
import {
  getValueAtPath,
  hasSameValuesAtPaths,
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
import {
  isServerClinicalWriteFenceActive,
  resolveEffectiveDailyRecordAuthorityMode,
} from '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode';
import { saveDailyRecordWithClinicalAuthorityCallable } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { recordSyncQueueTruthSelectionTelemetry } from '@/services/storage/sync/syncQueueTelemetryController';
import {
  assertNoSamePathRemoteMutation,
  hasRemoteAppliedMutation,
} from '@/services/storage/sync/firestoreSyncConflictPolicy';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import type { DetachedOccupantWork } from './dayTaskOccupantDetach';
import {
  adoptStoredClinicalDerivedState,
  withClearedStoredMovedFields,
} from '@/services/storage/clinicalDerivedWriteHygiene';
import { withStoredIdentity } from '@/shared/census/patientIdentityReview';
import { DailyRecordSchema, parseDailyRecordWithDefaultsReport } from '@/schemas/zodSchemas';

const STRICT_REMOTE_DRIFT_TOLERANCE_MS = 0;

/**
 * The authority answers with the stored day, which may hold an identity this client cannot read
 * (the replay wrote it back as stored). That day reaches the device cache with the bed under
 * review, like any read; a day that fits the schema is kept as it came.
 */
const readAuthorityAnswer = (record: DailyRecord): DailyRecord =>
  DailyRecordSchema.safeParse(record).success
    ? record
    : parseDailyRecordWithDefaultsReport(record, record.date).record;

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

interface ResolvedSyncRecordForTask {
  record: DailyRecord;
  resolution: NonNullable<SyncTask['syncContract']>['resolution'];
  acceptedVersion?: string;
  /** Stored day this resolution read; undefined when the day does not exist yet. */
  storedData?: Record<string, unknown>;
  /** Changed paths the merge left out: they stay pending as a conflict. */
  detachedPaths?: string[];
  /** Edits left out because their bed or crib now holds another patient or episode. */
  detached?: DetachedOccupantWork;
}

type DetachStaleOccupantPaths = (
  task: SyncTask,
  record: DailyRecord,
  remote: DailyRecord
) => DetachedOccupantWork | null;

const resolveRecordForSyncTask = async (
  queuedTask: SyncTask,
  queuedRecord: DailyRecord,
  runtime: FirestoreServiceRuntimePort,
  transaction?: Transaction,
  detachStaleOccupantPaths?: DetachStaleOccupantPaths
): Promise<ResolvedSyncRecordForTask> => {
  let task = queuedTask;
  let record = queuedRecord;
  const docRef = getRecordDocRef(record.date, runtime);
  const remoteSnap = await (transaction ? transaction.get(docRef) : getDoc(docRef));
  if (!remoteSnap.exists()) {
    return {
      record,
      resolution: 'accepted',
      acceptedVersion: record.lastUpdated,
    };
  }

  const remoteData = remoteSnap.data() as Record<string, unknown>;
  const remoteLastUpdated = getRemoteLastUpdated(remoteData);
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
  const alreadyApplied = (detached?: DetachedOccupantWork): ResolvedSyncRecordForTask => ({
    record: docToRecord(remoteData, record.date),
    resolution: 'already_applied',
    acceptedVersion: remoteLastUpdated,
    storedData: remoteData,
    detached,
  });
  // Edits written for a patient who left the bed or crib never reach the next occupant. They are
  // rebuilt even when the rest already landed, since the ACK that kept them may have rolled back.
  const detached =
    detachStaleOccupantPaths?.(task, record, docToRecord(remoteData, record.date)) ?? undefined;
  if (
    hasRemoteAppliedMutation(task, remoteData.meta as Record<string, unknown> | undefined) &&
    (!compacted || allCompactedValuesApplied)
  ) {
    return alreadyApplied(detached);
  }
  if (detached) {
    ({ task, record } = detached);
    // Nothing else to publish: the stored day stays as it is.
    if (!task.syncContract?.changedPaths?.length) return alreadyApplied(detached);
  }

  if (
    !detached &&
    !shouldRevalidateAgainstRemote(remoteLastUpdated, task.syncContract?.expectedVersion)
  ) {
    assertSyncQueueConcurrency(record, remoteLastUpdated);
    return {
      record,
      resolution: 'accepted',
      acceptedVersion: record.lastUpdated,
      storedData: remoteData,
    };
  }

  const remoteRecord = docToRecord(remoteData, record.date);
  assertNoSamePathRemoteMutation(task, remoteData, remoteRecord, record);
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
    detachedPaths: findDetachedReviewEdits(remoteRecord, record, consistency.record, changedPaths),
    detached,
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
  runtime: FirestoreServiceRuntimePort
): Promise<SyncTransportResult | void> => {
  if (await runE2ESyncTransport(task)) return;
  const occupants = task.syncContract?.changedPaths?.some(path => /^beds\.[^.]+\./.test(path))
    ? await import('./dexieDailyRecordOutbox')
    : undefined;
  const detach = occupants?.detachStaleOccupantPaths;
  let detached: DetachedOccupantWork | undefined;
  const result = await measureRepositoryOperation(
    'syncQueue.writeDailyRecord',
    async (): Promise<SyncTransportResult> => {
      const resolved = await resolveRecordForSyncTask(task, record, runtime, undefined, detach);
      detached = resolved.detached;
      if (resolved.resolution === 'already_applied') {
        recordSyncQueueTruthSelectionTelemetry(task, {
          resolution: resolved.resolution,
          acceptedVersion: resolved.acceptedVersion,
          selectedTruth: 'remote_already_applied',
        });
        return { authoritativeRecord: resolved.record };
      }
      const recordToWrite = resolved.record;

      assertResolvedClinicalAuthority(task, resolved);

      const effectiveAuthorityMode = await resolveEffectiveDailyRecordAuthorityMode(runtime);
      const writeFenceActive = await isServerClinicalWriteFenceActive(runtime);
      if (effectiveAuthorityMode === 'enforced' || writeFenceActive) {
        const response = await saveDailyRecordWithClinicalAuthorityCallable({
          date: recordToWrite.date,
          record: withStoredIdentity(recordToWrite),
          expectedLastUpdated: task.syncContract?.expectedVersion,
          mode: effectiveAuthorityMode === 'enforced' ? 'enforced' : 'shadow',
          origin: task.origin,
          syncContract: resolved.detached?.task.syncContract ?? task.syncContract,
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
        return {
          authoritativeRecord: readAuthorityAnswer(authoritativeRecord),
          detachedPaths: resolved.detachedPaths,
        };
      }

      if (effectiveAuthorityMode === 'shadow') {
        try {
          await saveDailyRecordWithClinicalAuthorityCallable({
            date: recordToWrite.date,
            record: withStoredIdentity(recordToWrite),
            expectedLastUpdated: task.syncContract?.expectedVersion,
            mode: 'shadow',
            origin: task.origin,
            syncContract: resolved.detached?.task.syncContract ?? task.syncContract,
            dryRun: true,
          });
        } catch {
          // Shadow mode must never block legacy direct publish.
        }
      }

      const committed = await runTransaction(runtime.getDb(), async transaction => {
        // Re-evaluate the original intent against the snapshot protected by this transaction.
        // Firestore reruns this callback if another writer changes the document before commit.
        const current = await resolveRecordForSyncTask(task, record, runtime, transaction, detach);
        detached = current.detached;
        if (current.resolution === 'already_applied') return current;
        assertResolvedClinicalAuthority(task, current);
        // D9: the stored day keeps its split-day marker, meta and moved fields, and a create
        // never carries the marker (the rule would deny this entry forever; queues are never
        // purged). merge: true keeps omitted keys, so a moved field another episode left in the
        // slot is deleted. The same record and payload on unmarked days.
        const committedRecord = adoptStoredClinicalDerivedState(current.record, current.storedData);
        transaction.set(
          getRecordDocRef(committedRecord.date, runtime),
          withClearedStoredMovedFields(
            sanitizeForFirestore(withStoredIdentity(committedRecord)) as Record<string, unknown>,
            current.storedData,
            () => deleteField()
          ),
          { merge: true }
        );
        return { ...current, record: committedRecord };
      });
      recordSyncQueueTruthSelectionTelemetry(task, {
        resolution: committed.resolution,
        acceptedVersion: committed.acceptedVersion,
        selectedTruth:
          committed.resolution === 'already_applied'
            ? 'remote_already_applied'
            : 'legacy_direct_publish',
      });
      return { authoritativeRecord: committed.record, detachedPaths: committed.detachedPaths };
    },
    { thresholdMs: 180, context: record.date }
  );
  if (!detached) return result;
  // The conflicts are durable: the store writes them with this task's completion. The drafts
  // only offer the note text in the handoff view.
  if (detached.notes) await occupants?.publishDetachedNotes(detached.notes);
  return { ...result, detachedConflicts: detached.conflicts };
};

export const createFirestoreSyncTransport = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): SyncTransportPort => ({
  async run(task: SyncTask) {
    switch (task.type) {
      case 'ARCHIVE_CUDYR':
        await import('./cudyrArchiveTransport').then(({ replayCudyrArchive }) =>
          replayCudyrArchive(task, runtime)
        );
        return;
      case 'UPDATE_DAILY_RECORD':
        return syncDailyRecord(task, task.payload as DailyRecord, runtime);
      case 'UPDATE_SPECIALIST_HANDOFF':
        return loadSpecialistMedicalHandoffClient().then(({ replaySpecialistHandoff }) =>
          replaySpecialistHandoff(task)
        );
      default:
        throw new Error(`[SyncQueue] Unsupported task type: ${String(task.type)}`);
    }
  },
});
