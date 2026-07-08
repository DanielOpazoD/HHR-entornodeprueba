import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { SyncQueueOperationSnapshot } from '@/services/storage/sync';

export type SyncConvergenceStatus = 'healthy' | 'recoverable' | 'needs_review' | 'unsafe';
export type SyncConvergenceSeverity = 'info' | 'warning' | 'critical';
export type SyncConvergenceFindingType =
  | 'duplicate_active_patient'
  | 'movement_not_reflected'
  | 'handoff_divergent'
  | 'stale_outbox'
  | 'repeated_replay'
  | 'snapshot_missing';

export type SyncSnapshotRecoveryStatus =
  | 'available'
  | 'missing'
  | 'expired'
  | 'permission_denied'
  | 'save_failed'
  | 'unknown';

export interface SyncSnapshotRecoveryContext {
  status: SyncSnapshotRecoveryStatus;
  reason?: string;
}

export interface SyncConvergenceFinding {
  type: SyncConvergenceFindingType;
  status: Exclude<SyncConvergenceStatus, 'healthy'>;
  severity: SyncConvergenceSeverity;
  path: string;
  module: 'censo' | 'nursing_handoff' | 'medical_handoff' | 'sync' | 'recovery';
  message: string;
  affectedPatient?: string;
  evidence: Record<string, unknown>;
}

export interface EvaluateSyncConvergenceInput {
  localRecord?: DailyRecord | null;
  remoteRecord?: DailyRecord | null;
  outbox?: SyncQueueOperationSnapshot[];
  lastAuditEvent?: Partial<AuditLogEntry> | null;
  snapshotRecovery?: SyncSnapshotRecoveryContext | null;
  nowMs?: number;
  staleOutboxMs?: number;
}

export interface SyncConvergenceDiagnostic {
  status: SyncConvergenceStatus;
  summary: string;
  findings: SyncConvergenceFinding[];
  checkedAt: string;
  latestAuditEventAt?: string;
}
