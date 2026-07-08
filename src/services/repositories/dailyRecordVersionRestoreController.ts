import type { DailyRecord } from '@/types/domain/dailyRecord';
import { getConflictVersionSnapshot } from '@/services/storage/firestore/dailyRecordConflictSnapshotService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { saveRecordToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import {
  logRepositoryConflictVersionRestored,
  type ConflictVersionRestoreAuditDetails,
} from '@/services/repositories/ports/repositoryAuditPort';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import {
  analyzeDailyRecordRestoreImpact,
  type DailyRecordRestoreImpactAnalysis,
} from '@/services/repositories/dailyRecordRestoreImpactAnalyzer';

const RESTORE_IMPACT_AUDIT_LIMIT = 12;

export type RestoreDailyRecordVersionResult =
  | { status: 'restored' }
  | { status: 'not_found' }
  | { status: 'blocked'; impactAnalysis: DailyRecordRestoreImpactAnalysis };

const buildAuditRestoreImpact = (
  impactAnalysis: DailyRecordRestoreImpactAnalysis
): NonNullable<
  NonNullable<ConflictVersionRestoreAuditDetails['reviewContext']>['restoreImpact']
> => ({
  status: impactAnalysis.status,
  risk: impactAnalysis.risk,
  impactedModules: impactAnalysis.impactedModules,
  blockingImpactCount: impactAnalysis.blockingImpactCount,
  currentRevision: impactAnalysis.currentRevision,
  selectedRevision: impactAnalysis.selectedRevision,
  impactCount: impactAnalysis.impacts.length,
  impactsTruncated: impactAnalysis.impacts.length > RESTORE_IMPACT_AUDIT_LIMIT,
  impacts: impactAnalysis.impacts.slice(0, RESTORE_IMPACT_AUDIT_LIMIT).map(impact => ({
    kind: impact.kind,
    module: impact.module,
    severity: impact.severity,
    path: impact.path,
    message: impact.message,
    ...(impact.patientName ? { patientName: impact.patientName } : {}),
    ...(impact.rut ? { rut: impact.rut } : {}),
    ...(impact.bedId ? { bedId: impact.bedId } : {}),
  })),
});

const enrichReviewContextWithImpact = (
  reviewContext: ConflictVersionRestoreAuditDetails['reviewContext'] | undefined,
  impactAnalysis: DailyRecordRestoreImpactAnalysis
): ConflictVersionRestoreAuditDetails['reviewContext'] | undefined => {
  if (!reviewContext) return undefined;
  return {
    ...reviewContext,
    restoreImpact: buildAuditRestoreImpact(impactAnalysis),
  };
};

/**
 * Restores a daily-record version selected by an authorized clinical conflict manager.
 *
 * Restoring overwrites live clinical data, so it is audited and **fails closed**: the permanent
 * `CONFLICT_VERSION_RESTORED` audit is written FIRST, and only if it succeeds is the record saved —
 * there is never an unaudited overwrite (an anonymous actor or a failed audit write aborts before
 * any mutation). The save itself is an atomic full-save with the CURRENT version as the base, so the
 * state live at restore time is snapshotted to `history` (non-destructive) and the chosen version
 * becomes the new live record; it bypasses the erasure pre-check that normal saves run (choosing a
 * version is an explicit, reversible clinical-conflict-manager action). The other conflict versions remain in
 * `conflictSnapshots/` until their TTL. See docs/ADR_CONFLICT_VERSION_RECOVERY.md.
 */
export const restoreDailyRecordVersion = async (
  date: string,
  snapshotId: string,
  reviewContext?: ConflictVersionRestoreAuditDetails['reviewContext']
): Promise<RestoreDailyRecordVersionResult> => {
  const snapshot = await getConflictVersionSnapshot(date, snapshotId);
  if (!snapshot) {
    return { status: 'not_found' };
  }

  const current = await getRecordFromFirestore(date);
  const restoredRecord: DailyRecord = { ...snapshot.record, date };
  const impactAnalysis = analyzeDailyRecordRestoreImpact({
    date,
    current,
    selectedSnapshot: restoredRecord,
  });

  if (impactAnalysis.status === 'blocked') {
    return { status: 'blocked', impactAnalysis };
  }

  // Fail closed: audit BEFORE mutating the record. logRepositoryConflictVersionRestored throws when
  // the audit outcome is not successful, so a rejected audit aborts here — no unaudited overwrite.
  await logRepositoryConflictVersionRestored(date, {
    snapshotId,
    origin: snapshot.origin,
    conflictId: snapshot.conflictId,
    ...(reviewContext
      ? { reviewContext: enrichReviewContextWithImpact(reviewContext, impactAnalysis) }
      : {}),
  });

  try {
    await saveRecordToFirestore(restoredRecord, current?.lastUpdated);
  } catch (saveError) {
    // The audit row is already written but the save failed (rare): a "phantom" restore audit.
    // Surface it for reconciliation; the authorized reviewer still sees the failure via the rethrow.
    recordOperationalErrorTelemetry('firestore', 'restore_daily_record_version_save', saveError, {
      code: 'firestore_conflict_restore_save_failed_post_audit',
      message: 'La restauración se auditó pero el guardado del registro falló.',
      severity: 'warning',
      userSafeMessage: 'No se pudo restaurar la versión.',
      context: { date, snapshotId },
    });
    throw saveError;
  }

  return { status: 'restored' };
};
