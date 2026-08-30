import { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { getRecordForDate as getRecordFromIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  subscribeToRecord,
  type FirestoreRecordSnapshotMetadata,
} from '@/services/storage/firestore/firestoreRecordQueries';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { migrateLegacyData } from '@/services/repositories/dataMigration';
import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';
import { createSyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { dailyRecordSyncLogger } from '@/services/repositories/repositoryLoggers';
import { resolveDailyRecordSyncConsistency } from '@/services/repositories/dailyRecordConsistencyPolicy';
import { resolveDailyRecordPersistenceGoldenPath } from '@/services/repositories/dailyRecordPersistenceGoldenPath';
import { persistHydratedRecordToLocalCache } from '@/services/repositories/dailyRecordLocalCachePersistence';
import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { buildDailyRecordSyncContract } from '@/services/storage/sync/syncTaskContractPolicy';
import { adoptAuthoritativeDailyRecordAtomically } from '@/services/storage/sync';
import { classifyConflictChangedContexts } from '@/services/repositories/conflictResolutionDomainPolicy';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { rebasePendingDailyRecordWrite } from '@/services/repositories/dailyRecordPendingWriteRebase';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { buildPendingDailyRecordReplacementTask } from '@/services/storage/sync/syncQueuePendingDailyRecordReplacement';
import type { DailyRecord as StoredDailyRecord } from '@/services/storage/storageDailyRecordContracts';

const resolveSubscriptionResult = async (
  date: string,
  remoteRecord: DailyRecord | null,
  remoteAvailability: 'resolved' | 'missing' | 'unavailable'
): Promise<SyncDailyRecordResult> => {
  const localRecord = await getRecordFromIndexedDB(date);
  const goldenPath = resolveDailyRecordPersistenceGoldenPath({
    localRecord,
    remoteRecord,
    remoteAvailability,
    clinicalConsistencyPhase: 'sync_publish',
  });
  if (goldenPath.shouldHydrateLocal && remoteRecord) {
    try {
      await persistHydratedRecordToLocalCache(
        goldenPath.selectedRecord || remoteRecord,
        date,
        localRecord
      );
    } catch (error) {
      if (error instanceof AdmissionDatePolicyViolationError) {
        dailyRecordSyncLogger.warn(
          `Skipped local hydration for ${date} due to admissionDate validation`,
          error
        );
      } else {
        throw error;
      }
    }
  }
  const record = goldenPath.selectedRecord;
  const consistency = resolveDailyRecordSyncConsistency({
    localRecord,
    remoteRecord,
    selectedRecord: record,
    remoteAvailability,
  });

  return createSyncDailyRecordResult({
    date,
    outcome:
      consistency.consistencyState === 'blocked'
        ? 'blocked'
        : consistency.consistencyState === 'missing_remote'
          ? 'missing'
          : 'clean',
    record,
    consistencyState: consistency.consistencyState,
    sourceOfTruth: consistency.sourceOfTruth,
    retryability: consistency.retryability,
    recoveryAction: consistency.recoveryAction,
    conflictSummary: consistency.conflictSummary,
    observabilityTags: consistency.observabilityTags,
    userSafeMessage: consistency.userSafeMessage,
    repairApplied: consistency.repairApplied,
  });
};

export const subscribeDetailed = (
  date: string,
  callback: (result: SyncDailyRecordResult, hasPendingWrites: boolean) => void
): (() => void) => {
  let active = true;

  const unsubscribe = subscribeToRecord(date, (record, hasPendingWrites, metadata) => {
    void (async () => {
      if (!active) return;

      const migrated = record ? migrateLegacyData(record, date) : null;
      const remoteAvailability = resolveRealtimeRemoteAvailability(migrated, metadata);
      const result = hasPendingWrites
        ? createSyncDailyRecordResult({
            date,
            outcome: migrated ? 'clean' : 'missing',
            record: migrated,
            consistencyState: migrated ? 'up_to_date' : 'missing_remote',
            sourceOfTruth: migrated ? 'local' : 'none',
            retryability: 'not_applicable',
            recoveryAction: 'none',
            conflictSummary: null,
            observabilityTags: ['daily_record', 'sync', 'subscription_pending_write'],
            repairApplied: false,
          })
        : await resolveSubscriptionResult(date, migrated, remoteAvailability);

      if (!active) return;
      callback(result, hasPendingWrites);
    })();
  });

  return () => {
    active = false;
    unsubscribe();
  };
};

const resolveRealtimeRemoteAvailability = (
  record: DailyRecord | null,
  metadata?: FirestoreRecordSnapshotMetadata
): 'resolved' | 'missing' | 'unavailable' => {
  if (record) {
    return 'resolved';
  }

  if (metadata?.fromCache) {
    return 'unavailable';
  }

  return 'missing';
};

export const subscribe = (
  date: string,
  callback: (r: DailyRecord | null, hasPendingWrites: boolean) => void
): (() => void) =>
  subscribeDetailed(date, (result, hasPendingWrites) => {
    callback(result.record, hasPendingWrites);
  });

export const syncWithFirestoreDetailed = async (date: string) => {
  if (!isFirestoreEnabled()) return null;

  return measureRepositoryOperation(
    'dailyRecord.syncWithFirestore',
    async () => {
      const localRecord = await getRecordFromIndexedDB(date);
      try {
        const remoteResult = await loadRemoteRecordWithFallback(date);
        const goldenPath = resolveDailyRecordPersistenceGoldenPath({
          localRecord,
          remoteRecord: remoteResult.record,
          remoteAvailability: remoteResult.record ? 'resolved' : 'missing',
          clinicalConsistencyPhase: 'sync_publish',
        });
        if (goldenPath.shouldHydrateLocal && remoteResult.record) {
          try {
            await persistHydratedRecordToLocalCache(
              goldenPath.selectedRecord || remoteResult.record,
              date,
              localRecord
            );
          } catch (error) {
            if (error instanceof AdmissionDatePolicyViolationError) {
              dailyRecordSyncLogger.warn(
                `Skipped local hydration for ${date} due to admissionDate validation`,
                error
              );
            } else {
              throw error;
            }
          }
        }
        const record = goldenPath.selectedRecord;
        const consistency = resolveDailyRecordSyncConsistency({
          localRecord,
          remoteRecord: remoteResult.record,
          selectedRecord: record,
          remoteAvailability: remoteResult.record ? 'resolved' : 'missing',
        });
        return createSyncDailyRecordResult({
          date,
          outcome: consistency.consistencyState === 'missing_remote' ? 'missing' : 'clean',
          record,
          consistencyState: consistency.consistencyState,
          sourceOfTruth: consistency.sourceOfTruth,
          retryability: consistency.retryability,
          recoveryAction: consistency.recoveryAction,
          conflictSummary: consistency.conflictSummary,
          observabilityTags: consistency.observabilityTags,
          userSafeMessage: consistency.userSafeMessage,
          repairApplied: consistency.repairApplied,
        });
      } catch (err) {
        dailyRecordSyncLogger.warn(`Sync failed for ${date}`, err);
        const consistency = resolveDailyRecordSyncConsistency({
          localRecord,
          remoteRecord: null,
          selectedRecord: localRecord,
          remoteAvailability: 'unavailable',
        });
        return createSyncDailyRecordResult({
          date,
          outcome: 'blocked',
          record: localRecord,
          consistencyState: consistency.consistencyState,
          sourceOfTruth: consistency.sourceOfTruth,
          retryability: consistency.retryability,
          recoveryAction: consistency.recoveryAction,
          conflictSummary: consistency.conflictSummary,
          observabilityTags: consistency.observabilityTags,
          userSafeMessage: consistency.userSafeMessage,
          repairApplied: consistency.repairApplied,
        });
      }
    },
    { thresholdMs: 200, context: date }
  );
};

/**
 * Adopts a server-proven record. When a legacy pending write exists, first replace that exact
 * pending payload with the already-applied patch so it cannot replay stale state later.
 */
export const adoptAuthoritativeRecord = async (
  record: DailyRecord,
  alreadyAppliedPatch?: DailyRecordPatch
): Promise<DailyRecord> => {
  if (!alreadyAppliedPatch) {
    return persistHydratedRecordToLocalCache(record, record.date);
  }
  const authoritativeRecord = prepareDailyRecordForPersistence(record, record.date);
  const adoption = await adoptAuthoritativeDailyRecordAtomically(
    authoritativeRecord,
    (localRecord, task) => {
      const pendingRecord = task.payload as StoredDailyRecord | null | undefined;
      if (!task.id || !pendingRecord || pendingRecord.lastUpdated !== localRecord.lastUpdated) {
        return null;
      }
      const pendingTask = {
        taskId: task.id,
        record: pendingRecord,
        recordRevision: pendingRecord.lastUpdated,
        changedPaths: task.syncContract?.changedPaths || [],
        mutationId: task.syncContract?.mutationId,
      };
      const { record: rebasedRecord, changedPaths } = rebasePendingDailyRecordWrite({
        authoritativeRecord,
        pendingTask,
        alreadyAppliedPatch,
      });
      const syncContract = buildDailyRecordSyncContract(rebasedRecord, {
        expectedVersion: authoritativeRecord.lastUpdated,
        changedPaths,
      });
      return {
        record: rebasedRecord,
        task: buildPendingDailyRecordReplacementTask({
          record: rebasedRecord,
          existing: task,
          meta: {
            contexts: classifyConflictChangedContexts(changedPaths),
            origin: 'partial_update_retry',
            syncContract,
          },
        }),
      };
    }
  );
  if (adoption.status === 'blocked' || !adoption.record) {
    throw new ConcurrencyError(
      'La sincronización local pendiente cambió o comenzó a procesarse. Recargue el censo antes de reintentar la limpieza.'
    );
  }
  return adoption.record;
};

export const syncWithFirestore = async (date: string): Promise<DailyRecord | null> => {
  const result = await syncWithFirestoreDetailed(date);
  return result?.record ?? null;
};
