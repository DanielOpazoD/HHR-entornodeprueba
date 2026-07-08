import { getDoc, setDoc } from 'firebase/firestore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncTransportPort } from '@/services/storage/sync/syncQueuePorts';
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
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
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
  shouldShadowDailyRecordAuthorityCallable,
  shouldUseDailyRecordAuthorityCallable,
} from '@/services/storage/firestore/dailyRecordAuthorityMode';
import { saveDailyRecordWithClinicalAuthorityCallable } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import {
  recordSyncQueueTruthSelectionTelemetry,
  type SyncQueueSelectedTruth,
} from '@/services/storage/sync/syncQueueTelemetryController';
import {
  assertNoSamePathRemoteMutation,
  hasRemoteAppliedMutation,
} from '@/services/storage/sync/firestoreSyncConflictPolicy';

const STRICT_REMOTE_DRIFT_TOLERANCE_MS = 0;

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
  record: DailyRecord | null;
  resolution: NonNullable<SyncTask['syncContract']>['resolution'];
  acceptedVersion?: string;
  selectedTruth?: SyncQueueSelectedTruth;
}

const resolveRecordForSyncTask = async (
  task: SyncTask,
  record: DailyRecord,
  runtime: FirestoreServiceRuntimePort
): Promise<ResolvedSyncRecordForTask> => {
  const docRef = getRecordDocRef(record.date, runtime);
  const remoteSnap = await getDoc(docRef);
  if (!remoteSnap.exists()) {
    return {
      record,
      resolution: 'accepted',
      acceptedVersion: record.lastUpdated,
    };
  }

  const remoteData = remoteSnap.data() as Record<string, unknown>;
  const remoteLastUpdated = getRemoteLastUpdated(remoteData);
  if (hasRemoteAppliedMutation(task, remoteData.meta as Record<string, unknown> | undefined)) {
    return {
      record: null,
      resolution: 'already_applied',
      acceptedVersion: remoteLastUpdated,
      selectedTruth: 'remote_already_applied',
    };
  }

  if (!shouldRevalidateAgainstRemote(remoteLastUpdated, task.syncContract?.expectedVersion)) {
    assertSyncQueueConcurrency(record, remoteLastUpdated);
    return {
      record,
      resolution: 'accepted',
      acceptedVersion: record.lastUpdated,
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
  };
};

const syncDailyRecord = async (
  task: SyncTask,
  record: DailyRecord,
  runtime: FirestoreServiceRuntimePort
): Promise<void> => {
  await measureRepositoryOperation(
    'syncQueue.writeDailyRecord',
    async () => {
      const resolved = await resolveRecordForSyncTask(task, record, runtime);
      if (!resolved.record) {
        recordSyncQueueTruthSelectionTelemetry(task, {
          resolution: resolved.resolution,
          acceptedVersion: resolved.acceptedVersion,
          selectedTruth: resolved.selectedTruth || 'remote_already_applied',
        });
        return;
      }
      const recordToWrite = resolved.record;

      const authority = evaluateDailyRecordClinicalAuthority(recordToWrite, {
        date: recordToWrite.date,
        phase: 'sync_publish',
      });
      recordClinicalAuthorityTelemetry(authority);
      recordClinicalEpisodeIdCoverageTelemetry(recordToWrite, {
        date: recordToWrite.date,
        phase: 'sync_publish',
      });

      if (authority.status === 'blocked') {
        recordSyncQueueTruthSelectionTelemetry(task, {
          resolution: 'blocked',
          acceptedVersion: resolved.acceptedVersion,
          selectedTruth: 'blocked_before_publish',
        });
        throw new ConcurrencyError(
          `Sync queue: clinical authority blocked write for ${recordToWrite.date}.`
        );
      }

      if (shouldUseDailyRecordAuthorityCallable()) {
        const response = await saveDailyRecordWithClinicalAuthorityCallable({
          date: recordToWrite.date,
          record: recordToWrite,
          expectedLastUpdated: task.syncContract?.expectedVersion,
          mode: 'enforced',
          origin: task.origin,
          syncContract: task.syncContract,
        });
        recordSyncQueueTruthSelectionTelemetry(task, {
          resolution: resolved.resolution,
          acceptedVersion: recordToWrite.lastUpdated,
          acceptedRevision: response?.revision,
          selectedTruth: 'authority_intent_invariants',
        });
        return;
      }

      if (shouldShadowDailyRecordAuthorityCallable()) {
        try {
          await saveDailyRecordWithClinicalAuthorityCallable({
            date: recordToWrite.date,
            record: recordToWrite,
            expectedLastUpdated: task.syncContract?.expectedVersion,
            mode: 'shadow',
            origin: task.origin,
            syncContract: task.syncContract,
            dryRun: true,
          });
        } catch {
          // Shadow mode must never block legacy direct publish.
        }
      }

      await setDoc(
        getRecordDocRef(recordToWrite.date, runtime),
        sanitizeForFirestore(recordToWrite) as Record<string, unknown>,
        { merge: true }
      );
      recordSyncQueueTruthSelectionTelemetry(task, {
        resolution: resolved.resolution,
        acceptedVersion: recordToWrite.lastUpdated,
        selectedTruth: 'legacy_direct_publish',
      });
    },
    { thresholdMs: 180, context: record.date }
  );
};

export const createFirestoreSyncTransport = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): SyncTransportPort => ({
  async run(task: SyncTask) {
    switch (task.type) {
      case 'UPDATE_DAILY_RECORD':
        await syncDailyRecord(task, task.payload as DailyRecord, runtime);
        return;
      default:
        throw new Error(`[SyncQueue] Unsupported task type: ${String(task.type)}`);
    }
  },
});
