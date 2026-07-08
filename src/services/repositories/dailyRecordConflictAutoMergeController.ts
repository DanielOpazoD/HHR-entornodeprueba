import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ConflictAutoMergeRecoveryResult } from '@/services/repositories/contracts/dailyRecordWriteRecoveryResult';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { resolveDailyRecordConflictWithTrace } from '@/services/repositories/conflictResolutionMatrix';
import { evaluateDailyRecordConflictPostMergeInvariants } from '@/services/repositories/dailyRecordConflictPostMergeInvariantChecker';
import { buildConflictAutoMergeAuditDetails } from '@/services/repositories/conflictResolutionAuditSummary';
import { logRepositoryConflictAutoMerged } from '@/services/repositories/ports/repositoryAuditPort';
import { dailyRecordWriteSupportLogger } from '@/services/repositories/repositoryLoggers';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import {
  buildRecoveryTaskMeta,
  resolveEffectiveChangedPaths,
} from '@/services/repositories/dailyRecordWriteRecoveryController';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { buildDailyRecordSyncContract } from '@/services/storage/sync/syncTaskContractPolicy';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import {
  buildConflictId,
  saveConflictVersionSnapshots,
} from '@/services/storage/firestore/dailyRecordConflictSnapshotService';

const queueMergedRecoveryTask = async (
  record: DailyRecord,
  changedPaths: string[],
  expectedVersion?: string
): Promise<{ accepted: boolean; syncContract: SyncTaskContract }> => {
  const meta = buildRecoveryTaskMeta(changedPaths, 'conflict_auto_merge', expectedVersion);
  const syncContract = buildDailyRecordSyncContract(record, meta.syncContract);
  const result = await queueDailyRecordSyncTaskWithLocalRecord(record, {
    ...meta,
    syncContract,
  });
  return { accepted: result.accepted, syncContract };
};

export const attemptConflictAutoMergeRecovery = async (
  date: string,
  localRecord: DailyRecord,
  changedPaths: string[]
): Promise<ConflictAutoMergeRecoveryResult> => {
  const effectiveChangedPaths = resolveEffectiveChangedPaths(changedPaths);

  try {
    const remoteRecord = await getRecordFromFirestore(date);
    if (!remoteRecord) {
      return { status: 'not_possible' };
    }

    // Capture both pre-merge versions (cloud + incoming) so an admin can later restore either.
    // Best-effort and placed before the merge so it covers every conflict path that reaches here
    // (auto-merge AND the unrecoverable block). See docs/ADR_CONFLICT_VERSION_RECOVERY.md.
    const conflictId = buildConflictId(date, remoteRecord, localRecord);
    const snapshotRecovery = await saveConflictVersionSnapshots(date, conflictId, {
      remote: remoteRecord,
      incoming: localRecord,
    });

    const { record: merged, trace } = resolveDailyRecordConflictWithTrace(
      remoteRecord,
      localRecord,
      {
        changedPaths: effectiveChangedPaths,
      }
    );
    const postMergeInvariants = evaluateDailyRecordConflictPostMergeInvariants({
      remote: remoteRecord,
      local: localRecord,
      resolved: merged,
      context: { date, phase: 'persistence' },
    });

    if (postMergeInvariants.status === 'blocked') {
      recordOperationalErrorTelemetry(
        'firestore',
        'conflict_auto_merge_invariants',
        new Error(
          `Auto-merge blocked by post-merge invariants: ${postMergeInvariants.violations
            .map(violation => violation.path)
            .join(', ')}`
        ),
        {
          code: 'firestore_conflict_auto_merge_invariants_blocked',
          message: 'El auto-merge de conflicto fue bloqueado por invariantes clinicas.',
          severity: 'warning',
          userSafeMessage: 'No se pudo resolver automaticamente el conflicto clinico.',
          context: {
            date,
            changedPaths: effectiveChangedPaths,
            violations: postMergeInvariants.violations.map(violation => ({
              type: violation.type,
              path: violation.path,
              message: violation.message,
            })),
          },
        }
      );
      return { status: 'not_possible' };
    }

    const { accepted: queued, syncContract } = await queueMergedRecoveryTask(
      postMergeInvariants.record,
      effectiveChangedPaths,
      remoteRecord.lastUpdated
    );
    if (!queued) {
      return { status: 'not_possible' };
    }

    const auditDetails = buildConflictAutoMergeAuditDetails({
      changedPaths: effectiveChangedPaths,
      policyVersion: trace.policyVersion,
      traceEntries: trace.entries,
      conflictId,
      snapshotRecovery,
      syncContract,
    });

    try {
      await logRepositoryConflictAutoMerged(date, auditDetails);
    } catch (auditError) {
      // Auto-merge is a system recovery path; blocking it on an audit failure is worse than an
      // observable best-effort audit. Surface via telemetry (posture declared best-effort-observable
      // in scripts/clinical-mutation-audit-policy.json) instead of a silent warn.
      recordOperationalErrorTelemetry('firestore', 'conflict_auto_merge_audit', auditError, {
        code: 'firestore_conflict_auto_merge_audit_failed',
        message: 'No se pudo auditar el auto-merge de conflicto.',
        severity: 'warning',
        userSafeMessage: 'No se pudo auditar el auto-merge de conflicto.',
        context: { date },
      });
    }

    return { status: 'auto_merged' };
  } catch (mergeError) {
    dailyRecordWriteSupportLogger.warn('Auto-merge conflict fallback failed', mergeError);
    return { status: 'not_possible' };
  }
};
