import { createScopedLogger } from '@/services/utils/loggerScope';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const logger = createScopedLogger('AuditHook');

export interface AuditEventContext {
  userId: string;
  action: AuditAction;
  entityType: AuditLogEntry['entityType'];
  entityId: string;
}

/**
 * Surfaces a `failed` audit outcome through the structured logger so that
 * traceability rejections (e.g. clinical actions blocked by the actor policy)
 * are visible in operational telemetry instead of silently swallowed.
 *
 * Successful outcomes are intentionally a no-op: the audit log itself is the
 * primary record of success.
 */
export const reportAuditOutcome = (
  outcome: ApplicationOutcome<null>,
  context: AuditEventContext
): void => {
  if (outcome.status !== 'failed') return;
  logger.warn('Audit event rejected', { ...context, issues: outcome.issues });
};
