import { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { getRecordForDate as getRecordFromIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  subscribeToRecord,
  isServerConfirmedSnapshot,
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
import { getPendingDailyRecordProjection } from '@/services/storage/sync/dailyRecordSyncQueueReadService';

/**
 * Cache hydration preserves unresolved writes atomically. Callers then read the pending
 * projection afresh, including when golden-path selection did not need hydration.
 */
const hydrateLocalCache = async (
  record: DailyRecord,
  date: string,
  localRecord: DailyRecord | null
): Promise<void> => {
  try {
    await persistHydratedRecordToLocalCache(record, date, localRecord);
  } catch (error) {
    if (error instanceof AdmissionDatePolicyViolationError) {
      dailyRecordSyncLogger.warn(
        `Skipped local hydration for ${date} due to admissionDate validation`,
        error
      );
      return;
    }
    throw error;
  }
};

const resolveSubscriptionResult = async (
  date: string,
  remoteRecord: DailyRecord | null,
  serverConfirmed: boolean,
  localRecord?: DailyRecord | null,
  isCurrent: () => boolean = () => true
): Promise<SyncDailyRecordResult> => {
  localRecord = localRecord === undefined ? await getRecordFromIndexedDB(date) : localRecord;
  const remoteAvailability = remoteRecord
    ? 'resolved'
    : serverConfirmed
      ? 'missing'
      : 'unavailable';
  const goldenPath = resolveDailyRecordPersistenceGoldenPath({
    localRecord,
    remoteRecord,
    remoteAvailability,
    clinicalConsistencyPhase: 'sync_publish',
  });
  if (goldenPath.shouldHydrateLocal && remoteRecord && isCurrent()) {
    await hydrateLocalCache(goldenPath.selectedRecord || remoteRecord, date, localRecord);
  }
  const retainedRecord = await getPendingDailyRecordProjection(date);
  const record = retainedRecord ?? goldenPath.selectedRecord;
  const consistency = resolveDailyRecordSyncConsistency({
    localRecord: retainedRecord ?? localRecord,
    remoteRecord,
    selectedRecord: record,
    remoteAvailability,
    pendingLocalWritesRetained: Boolean(retainedRecord),
  });

  return createSyncDailyRecordResult({
    date,
    serverConfirmed,
    outcome:
      consistency.consistencyState === 'blocked'
        ? 'blocked'
        : consistency.consistencyState === 'missing_remote'
          ? 'missing'
          : 'clean',
    record,
    ...consistency,
  });
};

export const subscribeDetailed = (
  date: string,
  callback: (result: SyncDailyRecordResult, hasPendingWrites: boolean) => void,
  onFailure?: (result: SyncDailyRecordResult) => void
): (() => void) => {
  let phase: 'listening' | 'failed' | 'stopped' = 'listening';
  let issued = 0;
  const isCurrent = (revision: number) => phase !== 'stopped' && revision === issued;
  const deliver = (notify: () => void) => {
    try {
      notify();
    } catch {
      dailyRecordSyncLogger.warn('Daily record subscription consumer failed', { date });
    }
  };
  const fail = () =>
    deliver(() =>
      onFailure?.(
        createSyncDailyRecordResult({
          date,
          outcome: 'blocked',
          record: null,
          ...resolveDailyRecordSyncConsistency({
            localRecord: null,
            remoteRecord: null,
            selectedRecord: null,
            remoteAvailability: 'unavailable',
          }),
          retryability: 'manual_retry',
        })
      )
    );

  const unsubscribe = subscribeToRecord(
    date,
    (record, hasPendingWrites, metadata) => {
      if (phase !== 'listening') return;
      const revision = ++issued;
      void (async () => {
        const migrated = record ? migrateLegacyData(record, date) : null;
        const serverConfirmed = !hasPendingWrites && isServerConfirmedSnapshot(metadata);
        const result = hasPendingWrites
          ? createSyncDailyRecordResult({
              date,
              outcome: migrated ? 'clean' : 'blocked',
              record: migrated,
              consistencyState: migrated ? 'up_to_date' : 'blocked',
              sourceOfTruth: migrated ? 'local' : 'none',
              retryability: 'not_applicable',
              recoveryAction: 'none',
              conflictSummary: null,
              observabilityTags: ['daily_record', 'sync', 'subscription_pending_write'],
              repairApplied: false,
            })
          : await resolveSubscriptionResult(date, migrated, serverConfirmed, undefined, () =>
              isCurrent(revision)
            );

        return result;
      })().then(
        result => {
          if (isCurrent(revision)) deliver(() => callback(result, hasPendingWrites));
        },
        () => {
          if (!isCurrent(revision)) return;
          dailyRecordSyncLogger.warn('Daily record subscription resolution failed', { date });
          fail();
        }
      );
    },
    () => {
      if (phase !== 'listening') return;
      phase = 'failed';
      issued += 1;
      fail();
    }
  );

  return () => {
    phase = 'stopped';
    issued += 1;
    unsubscribe();
  };
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
        return await resolveSubscriptionResult(
          date,
          remoteResult.record,
          remoteResult.serverConfirmed,
          localRecord
        );
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
          ...consistency,
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
      const {
        record: rebasedRecord,
        changedPaths,
        pendingPaths,
      } = rebasePendingDailyRecordWrite({
        authoritativeRecord,
        pendingTask,
        alreadyAppliedPatch,
      });
      if (pendingPaths.length === 0) {
        // Supersesión total: el comando confirmado cubrió todo lo que la tarea
        // tenía pendiente. Adoptar el registro autoritativo y eliminar la tarea
        // en la misma transacción; re-emitirla sólo replicaría estado ya durable.
        return { record: authoritativeRecord, task: null };
      }
      const syncContract = buildDailyRecordSyncContract(rebasedRecord, {
        expectedVersion: authoritativeRecord.lastUpdated,
        changedPaths,
      });
      return {
        record: rebasedRecord,
        task: buildPendingDailyRecordReplacementTask({
          record: rebasedRecord,
          // Reconciliation already removed durable paths. Merging the old ownership set
          // here would resurrect fields acknowledged by the authoritative command.
          existing: { ...task, syncContract: { ...task.syncContract, changedPaths: [] } },
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
