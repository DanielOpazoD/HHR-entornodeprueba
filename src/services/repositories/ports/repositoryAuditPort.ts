import { isAnonymousActor, isClinicalAuditAction } from '@/domain/audit/auditActorPolicy';
import { getCurrentUserEmail } from '@/services/admin/utils/auditUtils';
import type { DailyRecordRestoreImpactAnalysis } from '@/services/repositories/dailyRecordRestoreImpactAnalyzer';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

// A type alias, not an interface: audit details travel as Record<string, unknown>.
export type ConflictAuditDetails = {
  /** Correlates the audit entry with the recoverable version snapshots in `conflictSnapshots/`. */
  conflictId?: string;
  /** Whether recoverable pre-merge snapshots were stored for the clinical conflict center. */
  snapshotRecovery?: {
    status: 'saved' | 'failed';
    snapshotIds: string[];
    origins: string[];
    expiresAt?: string;
    ttlMs?: number;
  };
  /** Explains why the selected clinical truth is authority + intent + invariants, not last writer. */
  conflictResolutionSummary?: {
    truthSource: 'authority_intent_invariants';
    lastWriteWins: false;
    mergedPaths: string[];
    blockedPaths: string[];
    invariantChecks: string[];
    mutation?: {
      mutationId?: string;
      mutationIds?: string[];
      clientId?: string;
      tabId?: string;
    };
  };
  changedPaths: string[];
  policyVersion: string;
  entryCount: number;
  strategyBreakdown: Record<string, number>;
  winnerBreakdown: Record<string, number>;
  reasonBreakdown: Record<string, number>;
  samplePaths: string[];
  sampleDecisions?: Array<{
    path: string;
    strategy: string;
    winner: string;
    reason: string;
  }>;
  assessment: {
    riskLevel: 'low' | 'medium' | 'high';
    reviewRecommended: boolean;
    reviewReasons: string[];
    localDominantPaths: string[];
    remoteProtectedPaths: string[];
  };
};

type ConflictLoggerFn = (date: string, details: ConflictAuditDetails) => Promise<void>;

let customConflictLogger: ConflictLoggerFn | null = null;

export const setRepositoryConflictLogger = (logger: ConflictLoggerFn | null): void => {
  customConflictLogger = logger;
};

const writeRepositoryAuditEvent = async (
  action: AuditAction,
  entityType: AuditLogEntry['entityType'],
  date: string,
  details: Record<string, unknown>,
  fallbackErrorMessage: string
): Promise<void> => {
  const userId = getCurrentUserEmail();
  if (isClinicalAuditAction(action) && isAnonymousActor(userId)) {
    throw new Error(
      `No se persistió evento clínico ${action} (entidad ${date}): el actor de auditoría no es atribuible a un usuario autenticado.`
    );
  }

  const { logAuditEvent } = await import('@/services/admin/auditService');
  const delivery = await logAuditEvent(userId, action, entityType, date, details, undefined, date);
  if (delivery === 'rejected' || delivery === 'failed') {
    throw new Error(fallbackErrorMessage);
  }
};

export const logRepositoryConflictAutoMerged = async (
  date: string,
  details: ConflictAuditDetails
): Promise<void> => {
  if (customConflictLogger) {
    await customConflictLogger(date, details);
    return;
  }

  // Surface a failed audit outcome. The caller decides the posture: auto-merge is
  // best-effort-observable (see scripts/clinical-mutation-audit-policy.json), so it telemeters
  // rather than aborting — but the failure must not be silently dropped.
  await writeRepositoryAuditEvent(
    'CONFLICT_AUTO_MERGED',
    'dailyRecord',
    date,
    details,
    'No se pudo registrar la auditoría de auto-merge de conflicto.'
  );
};

// A type alias, not an interface: audit details travel as Record<string, unknown>.
export type ConflictVersionRestoreAuditDetails = {
  /** Snapshot document id that was restored. */
  snapshotId: string;
  /** Which side of the conflict it came from (e.g. remote_premerge / incoming_premerge). */
  origin: string;
  /** Correlates back to the conflict and its version snapshots. */
  conflictId?: string;
  /** Clinical review context captured by the conflict center before the overwrite is applied. */
  reviewContext?: {
    source: 'clinical_conflict_center';
    scope: 'census' | 'nursing_handoff' | 'medical_handoff';
    reason: 'manual_preserve_selected_truth';
    selectedVersionLabel?: string;
    modules?: Array<{ key: string; label: string }>;
    patientContexts?: Array<{
      patientName: string;
      rut?: string;
      bedName?: string;
      bedId?: string;
    }>;
    patientContextCount?: number;
    patientContextsTruncated?: boolean;
    changedFields?: Array<{
      path: string;
      module: string;
      label: string;
      before: string;
      after: string;
      bedId?: string;
    }>;
    changedFieldCount?: number;
    changedFieldsTruncated?: boolean;
    restoreImpact?: Pick<
      DailyRecordRestoreImpactAnalysis,
      | 'status'
      | 'risk'
      | 'impactedModules'
      | 'blockingImpactCount'
      | 'currentRevision'
      | 'selectedRevision'
    > & {
      impactCount: number;
      impactsTruncated?: boolean;
      impacts: Array<{
        kind: string;
        module: string;
        severity: string;
        path: string;
        message: string;
        patientName?: string;
        rut?: string;
        bedId?: string;
      }>;
    };
  };
};

/**
 * Audits an authorized reviewer restoring a daily-record version from the conflict panel. Permanent (the
 * recoverable snapshots themselves expire via TTL, but this trail does not). See
 * docs/ADR_CONFLICT_VERSION_RECOVERY.md.
 */
export const logRepositoryConflictVersionRestored = async (
  date: string,
  details: ConflictVersionRestoreAuditDetails
): Promise<void> => {
  // Surface an anonymous actor rejection or underlying write failure as a throw so the restore
  // caller can fail closed instead of silently overwriting the record without an audit row.
  await writeRepositoryAuditEvent(
    'CONFLICT_VERSION_RESTORED',
    'dailyRecord',
    date,
    details,
    'No se pudo registrar la auditoría de restauración de versión en conflicto.'
  );
};
