import { guardAuthoringSession } from '@/services/session/authoringSession';
import { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { captureLocalRecordBase } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  subscribeToRecord,
  isServerConfirmedSnapshot,
} from '@/services/storage/firestore/firestoreRecordQueries';
import { describeRemoteDailyRecord } from '@/services/repositories/dailyRecordRemoteLoader';
import { resolveRemoteGoldenPathReadResult } from '@/services/repositories/dailyRecordRemoteReadController';
import {
  createUnavailableDailyRecordReadResult,
  type DailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { dailyRecordSyncLogger } from '@/services/repositories/repositoryLoggers';
import { admitRemoteDailyRecords } from '@/services/repositories/dailyRecordLocalCachePersistence';
import { buildDailyRecordSyncContract } from '@/services/storage/sync/syncTaskContractPolicy';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
import { adoptAuthoritativeDailyRecordAtomically } from '@/services/storage/sync';
import { classifyConflictChangedContexts } from '@/services/repositories/conflictResolutionDomainPolicy';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { rebasePendingDailyRecordWrite } from '@/services/repositories/dailyRecordPendingWriteRebase';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { buildPendingDailyRecordReplacementTask } from '@/services/storage/sync/syncQueuePendingDailyRecordReplacement';
import type { DailyRecord as StoredDailyRecord } from '@/types/domain/dailyRecord';

/**
 * The day as the listener sees it. Each server snapshot goes through the same admission as a point
 * read (`resolveRemoteGoldenPathReadResult`), so one server day is kept here in one form whichever
 * channel brought it. A snapshot with pending writes is this tab's own echo and is not resolved.
 */
export const subscribeDetailed = (
  date: string,
  callback: (result: DailyRecordReadResult) => void,
  onFailure?: (result: DailyRecordReadResult) => void
): (() => void) => {
  let active = true;
  let issued = 0;
  const session = guardAuthoringSession();
  const isCurrent = (revision: number) => active && revision === issued && session.isCurrent();
  const reportFailure = (stage: 'consumer' | 'resolution') =>
    dailyRecordSyncLogger.warn('Daily record subscription failed', { date, stage });
  const deliver = (notify: () => void) => {
    try {
      notify();
    } catch {
      reportFailure('consumer');
    }
  };
  const fail = () => deliver(() => onFailure?.(createUnavailableDailyRecordReadResult(date)));

  const unsubscribe = subscribeToRecord(
    date,
    (record, hasPendingWrites, metadata) => {
      if (!active) return;
      const revision = ++issued;
      if (hasPendingWrites) return;
      void (async () => {
        const base = await captureLocalRecordBase(date);
        const remoteReadResult = await describeRemoteDailyRecord(date, record, {
          serverConfirmed: isServerConfirmedSnapshot(metadata),
        });
        return resolveRemoteGoldenPathReadResult({
          date,
          remoteReadResult,
          base,
          isCurrent: () => isCurrent(revision),
        });
      })().then(
        result => {
          if (isCurrent(revision)) deliver(() => callback(result));
        },
        () => {
          if (!isCurrent(revision)) return;
          reportFailure('resolution');
          fail();
        }
      );
    },
    () => {
      if (!active) return;
      active = false;
      fail();
    }
  );

  return () => {
    active = false;
    unsubscribe();
  };
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
    const [admission] = await admitRemoteDailyRecords([{ record, remoteRecord: record }]);
    if (!admission || !admission.record) throw new Error('No existe una fila admitida.');
    return admission.record;
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
      // A field's base value and the version it is checked against are one server instant
      // (SAVE-02): the task moves to the confirmed version only while every pending field still
      // holds its base there. Otherwise another computer changed it, and the task keeps its own
      // version, so its replay and the next edit of that field still meet that change.
      const bases = task.patchBaseValues ?? {};
      const basesHold = changedPaths.every(
        path =>
          !Object.hasOwn(bases, path) ||
          hasSameComparableValue(getValueAtPath(authoritativeRecord, path), bases[path])
      );
      const syncContract = {
        ...buildDailyRecordSyncContract(rebasedRecord, {
          expectedVersion: authoritativeRecord.lastUpdated,
          changedPaths,
        }),
        ...(basesHold
          ? {}
          : {
              expectedVersion: task.syncContract?.expectedVersion,
              baseRevision: task.syncContract?.baseRevision,
            }),
      };
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
