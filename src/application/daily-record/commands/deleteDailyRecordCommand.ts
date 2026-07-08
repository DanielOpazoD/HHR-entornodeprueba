/**
 * Fail-closed deletion of a whole daily record.
 *
 * Deleting a daily census record removes clinical data, so it is audited and **fails closed**: the
 * DAILY_RECORD_DELETED audit is written FIRST, and only if it succeeds is the record deleted — an
 * anonymous actor or a failed audit write aborts before any deletion (no unaudited clinical-record
 * delete, Ley 20.584).
 *
 * Residual: if the audit succeeds but the delete then fails, a "phantom" audit (deletion recorded
 * but not performed) can result. That is the accepted trade-off vs. an unaudited deletion — the same
 * posture as executeDeletePrescription. See docs/CLINICAL_MUTATION_AUDIT_POLICY.md.
 */
import {
  loadExecuteWriteAuditEvent,
  type WriteAuditEvent,
} from '@/application/audit/writeAuditEventUseCaseLoader';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

export interface DeleteDailyRecordInput {
  date: string;
  /** Verified actor performing the deletion. Required: a fail-closed delete must not synthesize one. */
  deletedBy: string;
  /** Performs the actual cross-store deletion (injected so the use-case stays port-agnostic). */
  deleteRecord: (date: string) => Promise<void>;
}

export interface DeleteDailyRecordDeps {
  writeAuditEvent?: WriteAuditEvent;
}

export const executeDeleteDailyRecord = async (
  input: DeleteDailyRecordInput,
  deps: DeleteDailyRecordDeps = {}
): Promise<ApplicationOutcome<null>> => {
  const writeAuditEvent = deps.writeAuditEvent || (await loadExecuteWriteAuditEvent());

  const auditOutcome = await writeAuditEvent({
    userId: input.deletedBy,
    action: 'DAILY_RECORD_DELETED',
    entityType: 'dailyRecord',
    entityId: input.date,
    recordDate: input.date,
    details: { date: input.date },
  });
  if (auditOutcome.status === 'failed') {
    return auditOutcome;
  }

  try {
    await input.deleteRecord(input.date);
    return createApplicationSuccess(null);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message:
          error instanceof Error ? error.message : 'No se pudo eliminar el registro del día.',
      },
    ]);
  }
};
