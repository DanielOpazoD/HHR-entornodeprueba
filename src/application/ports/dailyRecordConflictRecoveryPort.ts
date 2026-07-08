import type { ConflictVersionSnapshot } from '@/services/storage/firestore/dailyRecordConflictSnapshotService';
import type { RestoreDailyRecordVersionResult } from '@/services/repositories/dailyRecordVersionRestoreController';
import type { ConflictVersionRestoreAuditDetails } from '@/services/repositories/ports/repositoryAuditPort';
import type { AuditLogEntry } from '@/types/auditLogTypes';

export type { ConflictVersionSnapshot } from '@/services/storage/firestore/dailyRecordConflictSnapshotService';
export type { RestoreDailyRecordVersionResult } from '@/services/repositories/dailyRecordVersionRestoreController';

export type ConflictSnapshotRecoveryEvidence = {
  status?: 'saved' | 'failed';
  snapshotIds?: string[];
  origins?: string[];
  expiresAt?: string;
  ttlMs?: number;
  unavailableReason?:
    | 'expired_ttl'
    | 'permission_denied'
    | 'query_index_missing'
    | 'not_found'
    | 'unknown';
};

const isSnapshotRecoveryEvidence = (value: unknown): value is ConflictSnapshotRecoveryEvidence => {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return status === 'saved' || status === 'failed';
};

export const resolveLatestConflictSnapshotRecoveryFromAuditLogs = (
  logs: AuditLogEntry[],
  date: string
): ConflictSnapshotRecoveryEvidence | null => {
  const log = logs.find(
    entry =>
      entry.action === 'CONFLICT_AUTO_MERGED' &&
      entry.entityType === 'dailyRecord' &&
      (entry.entityId === date || entry.recordDate === date) &&
      isSnapshotRecoveryEvidence(entry.details?.snapshotRecovery)
  );
  return log ? (log.details.snapshotRecovery as ConflictSnapshotRecoveryEvidence) : null;
};

/**
 * Boundary the census UI uses to list and restore daily-record conflict versions, so feature
 * components never reach into the storage/repository services directly. See
 * docs/ADR_CONFLICT_VERSION_RECOVERY.md.
 */
export interface DailyRecordConflictRecoveryPort {
  listConflictVersionSnapshots: (date: string) => Promise<ConflictVersionSnapshot[]>;
  getLatestConflictSnapshotRecovery?: (
    date: string
  ) => Promise<ConflictSnapshotRecoveryEvidence | null>;
  restoreDailyRecordVersion: (
    date: string,
    snapshotId: string,
    reviewContext?: ConflictVersionRestoreAuditDetails['reviewContext']
  ) => Promise<RestoreDailyRecordVersionResult>;
}

export const defaultDailyRecordConflictRecoveryPort: DailyRecordConflictRecoveryPort = {
  listConflictVersionSnapshots: async date => {
    const { listConflictVersionSnapshots } =
      await import('@/services/storage/firestore/dailyRecordConflictSnapshotService');
    return listConflictVersionSnapshots(date);
  },
  getLatestConflictSnapshotRecovery: async date => {
    const { getAuditLogsForDate } = await import('@/services/admin/auditService');
    return resolveLatestConflictSnapshotRecoveryFromAuditLogs(
      await getAuditLogsForDate(date),
      date
    );
  },
  restoreDailyRecordVersion: async (date, snapshotId, reviewContext) => {
    const { restoreDailyRecordVersion } =
      await import('@/services/repositories/dailyRecordVersionRestoreController');
    return restoreDailyRecordVersion(date, snapshotId, reviewContext);
  },
};
